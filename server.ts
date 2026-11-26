import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import type {
  AnalysisErrorPayload,
  CollectedResearchData,
  ScannerBlueprintResult,
} from './src/types/blueprint.ts';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  interpretBusinessMaterial,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_COUNT,
  processUploadedFiles,
  type UploadedMaterialFile,
} from './server/inputInterpreter.ts';
import { runUniversalCompanyResearchFromMaterial } from './server/universalResearch.ts';
import {
  computeInputFingerprint,
  findResearchByFingerprint,
  getResearchById,
  saveBlueprintForResearch,
  saveResearchData,
} from './server/dataStore.ts';
import { generateLocalBlueprint } from './server/blueprintGenerator.ts';
import {
  createOptionalGeminiClient,
  enrichBlueprintWithGemini,
  type OptionalEnrichmentOutcome,
} from './server/geminiEnricher.ts';

const PORT = 3000;
const inFlightEnrichments = new Map<string, Promise<OptionalEnrichmentOutcome>>();

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: MAX_FILES_COUNT,
    },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      const extOk = /\.(png|jpg|jpeg|webp|gif|pdf|txt|csv|json|md)$/i.test(file.originalname || '');
      if (ALLOWED_UPLOAD_MIME_TYPES.has(mime) || extOk) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `Tipo de arquivo não suportado ("${file.originalname}"). Envie PNG, JPG, WEBP, GIF, PDF, TXT, CSV, JSON ou MD.`
          )
        );
      }
    },
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    const ai = createOptionalGeminiClient();
    res.json({ ok: true, geminiConfigured: Boolean(ai) });
  });

  app.get('/api/research/:researchId', (req: Request, res: Response) => {
    const record = getResearchById(String(req.params.researchId || ''));
    if (!record) {
      res.status(404).json({ error: 'Pesquisa não encontrada ou expirada.' });
      return;
    }
    res.json(record);
  });

  app.post('/api/blueprint-from-collected', (req: Request, res: Response) => {
    const researchId = typeof req.body?.researchId === 'string' ? req.body.researchId.trim() : '';
    const stored = researchId ? getResearchById(researchId) : null;
    const collected =
      (req.body?.collectedData as CollectedResearchData | undefined) ||
      stored?.collectedData;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;

    const hasCollectedContent = Boolean(
      collected &&
        typeof collected === 'object' &&
        (collected.placeName ||
          collected.legalName ||
          collected.cnpj ||
          collected.inputSummary ||
          collected.originalInputUrl)
    );

    if (!hasCollectedContent || !collected) {
      res.status(400).json({ error: 'Dados coletados inválidos ou ausentes para geração.' });
      return;
    }

    const activeRecord =
      stored ||
      saveResearchData({
        inputFingerprint: computeInputFingerprint(collected.originalInputUrl || collected.placeName || '', []),
        collectedData: collected,
        rawInput: collected.originalInputUrl,
      });

    const result = generateLocalBlueprint(collected, reason, {
      researchId: activeRecord.researchId,
      generationMode: 'local',
      reusedResearch: true,
      apiNotice: null,
    });
    saveBlueprintForResearch(activeRecord.researchId, result, 'local');
    res.json(result);
  });

  app.post('/api/enrich', async (req: Request, res: Response) => {
    const researchId = typeof req.body?.researchId === 'string' ? req.body.researchId.trim() : '';
    const stored = researchId ? getResearchById(researchId) : null;
    const collected =
      stored?.collectedData ||
      (req.body?.collectedData as CollectedResearchData | undefined);

    if (!collected) {
      res.status(400).json({ error: 'Nenhum dado preservado encontrado para enriquecimento.' });
      return;
    }

    const activeRecord =
      stored ||
      saveResearchData({
        inputFingerprint: computeInputFingerprint(collected.originalInputUrl || collected.placeName || '', []),
        collectedData: collected,
        rawInput: collected.originalInputUrl,
      });

    const localBaseline = generateLocalBlueprint(collected, undefined, {
      researchId: activeRecord.researchId,
      generationMode: 'local',
      reusedResearch: true,
      apiNotice: null,
    });

    const ai = createOptionalGeminiClient();
    let enrichPromise = inFlightEnrichments.get(activeRecord.researchId);
    if (!enrichPromise) {
      enrichPromise = enrichBlueprintWithGemini(ai, collected, localBaseline);
      inFlightEnrichments.set(activeRecord.researchId, enrichPromise);
    }

    let outcome: OptionalEnrichmentOutcome;
    try {
      outcome = await enrichPromise;
    } finally {
      inFlightEnrichments.delete(activeRecord.researchId);
    }

    if (outcome.ok) {
      const enrichedResult: ScannerBlueprintResult = {
        ...outcome.result,
        meta: {
          researchId: activeRecord.researchId,
          generationMode: 'gemini_enriched',
          reusedResearch: true,
          apiNotice: null,
        },
      };
      saveBlueprintForResearch(activeRecord.researchId, enrichedResult, 'gemini_enriched');
      res.json({ enriched: true, result: enrichedResult, notice: null });
      return;
    }

    const preservedLocalResult: ScannerBlueprintResult = {
      ...localBaseline,
      meta: {
        researchId: activeRecord.researchId,
        generationMode: 'local_fallback',
        reusedResearch: true,
        apiNotice: outcome.notice,
      },
    };
    saveBlueprintForResearch(activeRecord.researchId, preservedLocalResult, 'local');
    res.json({ enriched: false, result: preservedLocalResult, notice: outcome.notice });
  });

  app.post('/api/analyze', (req: Request, res: Response) => {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    const runPipeline = async (params: {
      rawText: string;
      uploadedFiles: UploadedMaterialFile[];
      requestedResearchId: string;
      forceResearch: boolean;
      forceRefresh: boolean;
      skipAi: boolean;
    }) => {
      const { rawText, uploadedFiles, requestedResearchId, forceResearch, forceRefresh, skipAi } = params;

      const existingById = requestedResearchId ? getResearchById(requestedResearchId) : null;
      if (!existingById && !rawText && uploadedFiles.length === 0) {
        res.status(400).json({
          error:
            'Envie alguma informação da empresa: cole um texto, CNPJ, nome, endereço, link ou anexe uma imagem/documento.',
        });
        return;
      }

      const ai = skipAi ? null : createOptionalGeminiClient();
      const inputFingerprint = computeInputFingerprint(rawText, uploadedFiles);
      const existingByFingerprint =
        !forceResearch && !existingById ? findResearchByFingerprint(inputFingerprint) : null;
      const reusableRecord = !forceResearch ? existingById || existingByFingerprint : null;

      // Validate text-only new inputs synchronously before opening SSE stream
      const isTextOnly = uploadedFiles.length === 0;
      let preInterpreted =
        !reusableRecord && isTextOnly
          ? interpretBusinessMaterial({ rawText, ocrText: null, documentText: null })
          : null;

      if (!reusableRecord && isTextOnly && preInterpreted && !preInterpreted.hasSufficientSignal) {
        res.status(400).json({
          error:
            'Não foi possível identificar nenhum indício empresarial válido (nome, CNPJ, telefone, endereço, @instagram ou link). Tente incluir mais detalhes.',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      let activeRecord = reusableRecord;
      let reusedResearch = Boolean(reusableRecord);

      try {
        // STAGE A & B: Pesquisa e Armazenamento (nunca repete pesquisa concluída)
        if (!activeRecord) {
          if (!preInterpreted) {
            sendSse(res, 'status', {
              stage: 'Processando anexos e leitura OCR',
              detail: `Lendo ${uploadedFiles.length} arquivo(s) enviado(s) para extrair dados empresariais.`,
            });
            const extractedFiles = await processUploadedFiles(
              uploadedFiles,
              ai,
              (stage, detail) => sendSse(res, 'status', { stage, detail })
            );
            preInterpreted = interpretBusinessMaterial({
              rawText,
              ocrText: extractedFiles.ocrText,
              documentText: extractedFiles.documentText,
              notes: extractedFiles.notes,
              limitations: extractedFiles.limitations,
            });
          }

          if (!preInterpreted.hasSufficientSignal) {
            const errorPayload: AnalysisErrorPayload = {
              status: 400,
              code: 'INVALID_INPUT',
              message:
                'Não encontramos nome comercial, CNPJ, telefone, endereço ou link legível no material enviado. Tente digitar o nome/CNPJ ou enviar uma imagem mais nítida.',
            };
            sendSse(res, 'error', errorPayload);
            res.end();
            return;
          }

          sendSse(res, 'status', {
            stage: 'Identificando empresa',
            detail: preInterpreted.sourceSummary,
          });

          const collectedData = await runUniversalCompanyResearchFromMaterial(preInterpreted, (stage, detail) => {
            sendSse(res, 'status', { stage, detail });
          });

          // STAGE B: Salva imediatamente antes de qualquer etapa de geração ou IA
          activeRecord = saveResearchData({
            inputFingerprint,
            collectedData,
            rawInput: rawText,
          });
          reusedResearch = false;
        } else {
          sendSse(res, 'status', {
            stage: 'Reutilizando dados preservados',
            detail: 'Pesquisa desta empresa já foi concluída anteriormente; etapas de coleta preservadas.',
          });
        }

        // Emite imediatamente os dados coletados e preservados para o cliente salvar localmente
        sendSse(res, 'collected', {
          researchId: activeRecord.researchId,
          reusedResearch,
          collectedData: activeRecord.collectedData,
        });

        // Se já existe um blueprint enriquecido armazenado e não foi pedido refresh, retorna direto
        if (
          !forceRefresh &&
          activeRecord.blueprint &&
          activeRecord.enrichmentMode === 'gemini_enriched'
        ) {
          sendSse(res, 'status', {
            stage: 'Recuperando projeto arquitetônico salvo',
            detail: 'Projeto completo e prompt final carregados do armazenamento local.',
          });
          sendSse(res, 'result', {
            ...activeRecord.blueprint,
            meta: {
              researchId: activeRecord.researchId,
              generationMode: 'gemini_enriched',
              reusedResearch: true,
              apiNotice: null,
            },
          });
          res.end();
          return;
        }

        // STAGE C & D: Processamento e Geração Local Independente (sempre conclui!)
        sendSse(res, 'status', {
          stage: 'Gerando projeto arquitetônico e prompt final',
          detail: activeRecord.collectedData.placeName
            ? `Estruturando os 11 pilares e prompt de construção para "${activeRecord.collectedData.placeName}".`
            : 'Estruturando os 11 pilares e prompt de construção com os dados preservados.',
        });

        const localResult = generateLocalBlueprint(activeRecord.collectedData, undefined, {
          researchId: activeRecord.researchId,
          generationMode: 'local',
          reusedResearch,
          apiNotice: null,
        });
        saveBlueprintForResearch(activeRecord.researchId, localResult, 'local');

        // STAGE E: Integração Opcional com Gemini (nunca interrompe ou descarta o projeto)
        if (!ai) {
          const reasonNotice: AnalysisErrorPayload | null = skipAi
            ? null
            : {
                status: 401,
                code: 'AUTH_ERROR',
                message:
                  'API Gemini não configurada no servidor. Projeto arquitetônico completo e prompt final gerados pelo motor local independente.',
                collectedData: activeRecord.collectedData,
              };
          if (reasonNotice) {
            sendSse(res, 'notice', reasonNotice);
          }
          sendSse(res, 'result', {
            ...localResult,
            meta: {
              researchId: activeRecord.researchId,
              generationMode: 'local',
              reusedResearch,
              apiNotice: reasonNotice,
            },
          });
          res.end();
          return;
        }

        sendSse(res, 'status', {
          stage: 'Refinando arquitetura (opcional via Gemini)',
          detail: 'Aplicando enriquecimento textual opcional preservando a base já concluída.',
        });

        let enrichPromise = inFlightEnrichments.get(activeRecord.researchId);
        if (!enrichPromise) {
          enrichPromise = enrichBlueprintWithGemini(ai, activeRecord.collectedData, localResult);
          inFlightEnrichments.set(activeRecord.researchId, enrichPromise);
        }

        let outcome: OptionalEnrichmentOutcome;
        try {
          outcome = await enrichPromise;
        } finally {
          inFlightEnrichments.delete(activeRecord.researchId);
        }

        if (outcome.ok) {
          const enrichedResult: ScannerBlueprintResult = {
            ...outcome.result,
            meta: {
              researchId: activeRecord.researchId,
              generationMode: 'gemini_enriched',
              reusedResearch,
              apiNotice: null,
            },
          };
          saveBlueprintForResearch(activeRecord.researchId, enrichedResult, 'gemini_enriched');
          sendSse(res, 'result', enrichedResult);
          res.end();
          return;
        }

        // Falha no Gemini (429 RESOURCE_EXHAUSTED, quota esgotada, offline ou 503):
        // Emite aviso não bloqueante e ENTREGA imediatamente o projeto local completo!
        const fallbackResult: ScannerBlueprintResult = {
          ...localResult,
          meta: {
            researchId: activeRecord.researchId,
            generationMode: 'local_fallback',
            reusedResearch,
            apiNotice: outcome.notice,
          },
        };
        saveBlueprintForResearch(activeRecord.researchId, fallbackResult, 'local');
        sendSse(res, 'notice', outcome.notice);
        sendSse(res, 'result', fallbackResult);
        res.end();
      } catch (error) {
        console.error('[VIRA SCANNER 3D] /api/analyze unexpected error:', error);
        if (activeRecord) {
          const fallbackNotice: AnalysisErrorPayload = {
            status: 500,
            code: 'UPSTREAM_ERROR',
            message:
              'Etapa complementar falhou, mas os dados coletados foram preservados e o projeto arquitetônico completo foi gerado localmente.',
            collectedData: activeRecord.collectedData,
          };
          const emergencyResult = generateLocalBlueprint(activeRecord.collectedData, undefined, {
            researchId: activeRecord.researchId,
            generationMode: 'local_fallback',
            reusedResearch: true,
            apiNotice: fallbackNotice,
          });
          saveBlueprintForResearch(activeRecord.researchId, emergencyResult, 'local');
          sendSse(res, 'notice', fallbackNotice);
          sendSse(res, 'result', emergencyResult);
          res.end();
          return;
        }

        const errPayload: AnalysisErrorPayload = {
          status: 500,
          code: 'UPSTREAM_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Erro inesperado ao interpretar o material enviado.',
        };
        sendSse(res, 'error', errPayload);
        res.end();
      }
    };

    if (contentType.includes('multipart/form-data')) {
      upload.array('files', MAX_FILES_COUNT)(req, res, (err) => {
        if (err) {
          const multerCode = (err as { code?: string }).code;
          const msg =
            multerCode === 'LIMIT_FILE_SIZE'
              ? 'Um dos arquivos excede o limite de 5 MB.'
              : multerCode === 'LIMIT_FILE_COUNT'
                ? `Envie no máximo ${MAX_FILES_COUNT} arquivos por identificação.`
                : err instanceof Error
                  ? err.message
                  : 'Falha ao processar os arquivos enviados.';
          res.status(400).json({ error: msg });
          return;
        }

        const rawText =
          typeof req.body?.text === 'string'
            ? req.body.text.trim()
            : typeof req.body?.url === 'string'
              ? req.body.url.trim()
              : typeof req.body?.mapsUrl === 'string'
                ? req.body.mapsUrl.trim()
                : '';
        const requestedResearchId =
          typeof req.body?.researchId === 'string' ? req.body.researchId.trim() : '';
        const forceResearch = req.body?.forceResearch === 'true' || req.body?.forceResearch === true;
        const forceRefresh = req.body?.forceRefresh === 'true' || req.body?.forceRefresh === true;
        const skipAi = req.body?.skipAi === 'true' || req.body?.skipAi === true;
        const expressFiles = Array.isArray(req.files) ? req.files : [];
        const uploadedFiles: UploadedMaterialFile[] = expressFiles.map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          buffer: f.buffer,
        }));

        void runPipeline({
          rawText,
          uploadedFiles,
          requestedResearchId,
          forceResearch,
          forceRefresh,
          skipAi,
        });
      });
    } else {
      const rawText =
        typeof req.body?.text === 'string'
          ? req.body.text.trim()
          : typeof req.body?.url === 'string'
            ? req.body.url.trim()
            : typeof req.body?.mapsUrl === 'string'
              ? req.body.mapsUrl.trim()
              : '';
      const requestedResearchId =
        typeof req.body?.researchId === 'string' ? req.body.researchId.trim() : '';
      const forceResearch = Boolean(req.body?.forceResearch);
      const forceRefresh = Boolean(req.body?.forceRefresh);
      const skipAi = Boolean(req.body?.skipAi);

      void runPipeline({
        rawText,
        uploadedFiles: [],
        requestedResearchId,
        forceResearch,
        forceRefresh,
        skipAi,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VIRA SCANNER 3D server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
