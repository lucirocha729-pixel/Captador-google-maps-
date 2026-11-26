import zlib from 'node:zlib';
import { createWorker } from 'tesseract.js';
import { GoogleGenAI } from '@google/genai';

export interface UploadedMaterialFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface InterpretedInput {
  rawText: string;
  combinedCorpus: string;
  ocrText: string | null;
  documentText: string | null;
  urls: string[];
  cnpjs: string[];
  maskedCpf: string | null;
  phones: string[];
  whatsapps: string[];
  emails: string[];
  instagramHandles: string[];
  addresses: string[];
  cityStates: string[];
  hours: string | null;
  businessName: string | null;
  legalName: string | null;
  segmentHint: string | null;
  sourceSummary: string;
  hasSufficientSignal: boolean;
  interpretationNotes: string[];
  limitations: string[];
}

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
]);

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const MAX_FILES_COUNT = 5;

const GOOGLE_UI_NOISE = new Set([
  'rotas',
  'salvar',
  'salvo',
  'compartilhar',
  'enviar para smartphone',
  'visão geral',
  'avaliações',
  'sobre',
  'fotos',
  'produtos',
  'atualizações',
  'ligar',
  'site',
  'menu',
  'cardápio',
  'aberto agora',
  'fechado agora',
  'sugerir uma alteração',
  'reivindicar esta empresa',
  'google maps',
  'pesquisa google',
  'resultados da pesquisa',
  'mapa',
  'ver mais',
]);

export function isValidCnpjDigits(rawDigits: string): boolean {
  const cnpj = rawDigits.replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(cnpj[12]) === d1 && Number(cnpj[13]) === d2;
}

export function isValidCpfDigits(rawDigits: string): boolean {
  const cpf = rawDigits.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let mod = (sum * 10) % 11;
  if (mod === 10) mod = 0;
  if (mod !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  mod = (sum * 10) % 11;
  if (mod === 10) mod = 0;
  return mod === Number(cpf[10]);
}

export function formatCnpjDigits(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function maskCpf(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

function extractTextFromPdfBuffer(buf: Buffer): string {
  const extractedParts: string[] = [];
  const rawLatin = buf.toString('latin1');

  const extractPdfLiterals = (chunk: string) => {
    const btBlocks = chunk.match(/BT[\s\S]*?ET/g) || [chunk];
    for (const block of btBlocks) {
      const literals = block.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|TJ|'|")/g) || [];
      for (const lit of literals) {
        const inner = lit.replace(/^\(/, '').replace(/\)\s*(?:Tj|TJ|'|")$/, '');
        const clean = inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, ' ')
          .replace(/\\([()\\])/g, '$1')
          .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ')
          .trim();
        if (clean.length >= 2) extractedParts.push(clean);
      }
    }
  };

  // Try FlateDecode streams first
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(rawLatin)) !== null) {
    const streamSlice = buf.subarray(
      match.index + match[0].indexOf(match[1]),
      match.index + match[0].indexOf(match[1]) + match[1].length
    );
    try {
      const inflated = zlib.inflateSync(streamSlice).toString('latin1');
      extractPdfLiterals(inflated);
    } catch {
      extractPdfLiterals(match[1]);
    }
  }

  if (extractedParts.length === 0) {
    extractPdfLiterals(rawLatin);
  }

  return extractedParts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
}

async function runTesseractOcr(imageBuffer: Buffer): Promise<string> {
  const runWithLang = async (lang: string): Promise<string> => {
    const worker = await createWorker(lang);
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tempo limite do OCR local atingido.')), 14000)
      );
      const result = await Promise.race([worker.recognize(imageBuffer), timeoutPromise]);
      return (result?.data?.text || '').trim();
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  };

  try {
    return await runWithLang('por+eng');
  } catch {
    return await runWithLang('eng');
  }
}

async function extractWithGeminiMultimodal(
  file: UploadedMaterialFile,
  geminiClient: GoogleGenAI | null
): Promise<{ text: string | null; rateLimited: boolean; error?: string }> {
  if (!geminiClient) {
    return { text: null, rateLimited: false };
  }

  try {
    const base64 = file.buffer.toString('base64');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tempo limite da leitura visual opcional (12s).')), 12000)
    );
    const resp = await Promise.race([
      geminiClient.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: file.mimetype,
                data: base64,
              },
            },
            {
              text: 'Extraia fielmente todo texto e dados comerciais visíveis nesta imagem/documento (nome da empresa, razão social, CNPJ, endereço, telefone, WhatsApp, horários, site, Instagram, Facebook, produtos/serviços). Não invente nada que não esteja visível.',
            },
          ],
        },
      }),
      timeoutPromise,
    ]);
    return { text: (resp.text || '').trim() || null, rateLimited: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const is429 = msg.includes('429') || msg.toLowerCase().includes('resource_exhausted');
    return { text: null, rateLimited: is429, error: msg };
  }
}

export async function processUploadedFiles(
  files: UploadedMaterialFile[],
  geminiClient: GoogleGenAI | null,
  onProgress?: (stage: string, detail: string) => void
): Promise<{
  ocrText: string | null;
  documentText: string | null;
  notes: string[];
  limitations: string[];
}> {
  const ocrSegments: string[] = [];
  const docSegments: string[] = [];
  const notes: string[] = [];
  const limitations: string[] = [];

  for (const file of files) {
    const mime = (file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');

    if (isImage) {
      onProgress?.(
        'Executando OCR e leitura visual da imagem',
        `Extraindo texto e dados empresariais de "${file.originalname}".`
      );

      let extracted: string | null = null;

      // Try local Tesseract OCR first (independent of GEMINI_API_KEY & zero quota cost!)
      try {
        const localText = await runTesseractOcr(file.buffer);
        if (localText && localText.replace(/\s+/g, '').length >= 6) {
          extracted = localText;
          notes.push(`OCR local extraído de "${file.originalname}".`);
        }
      } catch (err) {
        limitations.push(
          `OCR local não conseguiu processar "${file.originalname}" (${
            err instanceof Error ? err.message : 'erro desconhecido'
          }).`
        );
      }

      // If local OCR returned sparse text and Gemini key is configured, try Gemini multimodal
      if ((!extracted || extracted.length < 25) && geminiClient) {
        const aiVision = await extractWithGeminiMultimodal(file, geminiClient);
        if (aiVision.text) {
          extracted = extracted ? `${extracted}\n${aiVision.text}` : aiVision.text;
          notes.push(`Interpretação visual complementar aplicada em "${file.originalname}".`);
        } else if (aiVision.rateLimited) {
          limitations.push(
            `Interpretação visual por IA indisponível por limite 429; utilizando exclusivamente o OCR local de "${file.originalname}".`
          );
        }
      }

      if (extracted) {
        ocrSegments.push(`[Imagem: ${file.originalname}]\n${extracted}`);
      } else {
        limitations.push(
          `Não foi possível extrair texto legível da imagem "${file.originalname}".`
        );
      }
    } else if (isPdf) {
      onProgress?.(
        'Extraindo conteúdo de documento PDF',
        `Lendo dados empresariais de "${file.originalname}".`
      );
      let pdfText = extractTextFromPdfBuffer(file.buffer);
      if ((!pdfText || pdfText.length < 30) && geminiClient) {
        const aiPdf = await extractWithGeminiMultimodal(file, geminiClient);
        if (aiPdf.text) {
          pdfText = aiPdf.text;
        } else if (aiPdf.rateLimited) {
          limitations.push(
            `Leitura complementar por IA do PDF "${file.originalname}" atingiu limite 429; usando texto extraído localmente.`
          );
        }
      }
      if (pdfText) {
        docSegments.push(`[Documento: ${file.originalname}]\n${pdfText}`);
        notes.push(`Texto extraído do documento "${file.originalname}".`);
      } else {
        limitations.push(
          `O PDF "${file.originalname}" não contém texto selecionável legível (pode ser um PDF digitalizado sem camada de texto).`
        );
      }
    } else {
      const txt = file.buffer.toString('utf8').trim().slice(0, 15000);
      if (txt) {
        docSegments.push(`[Arquivo: ${file.originalname}]\n${txt}`);
        notes.push(`Conteúdo textual importado de "${file.originalname}".`);
      }
    }
  }

  return {
    ocrText: ocrSegments.length > 0 ? ocrSegments.join('\n\n') : null,
    documentText: docSegments.length > 0 ? docSegments.join('\n\n') : null,
    notes,
    limitations,
  };
}

function extractUrlsFromText(text: string): string[] {
  const found = new Set<string>();
  const explicitMatches = text.match(/https?:\/\/[^\s"'<>()]+/gi) || [];
  for (const m of explicitMatches) {
    const cleaned = m.replace(/[.,;:!?)\]]+$/, '');
    try {
      const u = new URL(cleaned);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        found.add(u.toString());
      }
    } catch {
      // ignore invalid
    }
  }

  // Also detect bare domains like instagram.com/empresa or empresa.com.br (ignoring email domains preceded by '@')
  const bareRegex =
    /(?:www\.)?(?:instagram\.com\/[a-zA-Z0-9._-]+|facebook\.com\/[a-zA-Z0-9._-]+|linkedin\.com\/company\/[a-zA-Z0-9._-]+|[a-z0-9-]+\.(?:com\.br|com|org\.br|org|net\.br|net|io)(?:\/[^\s,;)]*)?)/gi;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bareRegex.exec(text)) !== null) {
    const bare = bareMatch[0];
    const idx = bareMatch.index;
    const prevChar = idx > 0 ? text[idx - 1] : '';
    if (prevChar === '@' || prevChar === '/' || prevChar === '.') continue;
    if (/\.(png|jpg|jpeg|webp|gif|pdf|txt|csv|json|md)$/i.test(bare)) continue;

    const candidate = `https://${bare.replace(/[.,;:!?)\]]+$/, '')}`;
    try {
      const u = new URL(candidate);
      if (!Array.from(found).some((existing) => existing.includes(u.hostname))) {
        found.add(u.toString());
      }
    } catch {
      // ignore
    }
  }

  return Array.from(found);
}

function cleanLineCandidate(line: string): string {
  return line
    .replace(/^(?:[-•*·]+|\d{1,2}[.)]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function interpretBusinessMaterial(params: {
  rawText: string;
  ocrText: string | null;
  documentText: string | null;
  notes?: string[];
  limitations?: string[];
}): InterpretedInput {
  const combinedCorpus = [params.rawText, params.ocrText, params.documentText]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join('\n\n')
    .trim();

  const interpretationNotes: string[] = [...(params.notes || [])];
  const limitations: string[] = [...(params.limitations || [])];

  const urls = extractUrlsFromText(combinedCorpus);

  // Extract valid CNPJs (formatted or 14 contiguous digits with CNPJ context)
  const cnpjs: string[] = [];
  const formattedCnpjs = combinedCorpus.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g) || [];
  for (const m of formattedCnpjs) {
    const digits = m.replace(/\D/g, '');
    if (isValidCnpjDigits(digits) && !cnpjs.includes(digits)) {
      cnpjs.push(digits);
    }
  }

  const raw14Matches = combinedCorpus.match(/(?:^|[^\d])(\d{14})(?:[^\d]|$)/g) || [];
  for (const raw of raw14Matches) {
    const digits = raw.replace(/\D/g, '');
    if (isValidCnpjDigits(digits) && !cnpjs.includes(digits)) {
      cnpjs.push(digits);
    }
  }

  if (cnpjs.length > 1) {
    limitations.push(
      `Foram detectados ${cnpjs.length} CNPJs diferentes no material enviado (${cnpjs
        .map(formatCnpjDigits)
        .join(', ')}); será priorizado o primeiro para evitar mistura de empresas.`
    );
  }

  // Detect CPF (masked for privacy protection — either valid check digits or explicitly labeled "CPF")
  let maskedCpf: string | null = null;
  const rawCpfsToScrub: string[] = [];
  const explicitCpfRegex = /\bCPF\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/gi;
  let expCpfMatch: RegExpExecArray | null;
  while ((expCpfMatch = explicitCpfRegex.exec(combinedCorpus)) !== null) {
    const digits = expCpfMatch[1].replace(/\D/g, '');
    const isInsideCnpj = cnpjs.some((c) => c.includes(digits));
    if (!isInsideCnpj && digits.length === 11) {
      rawCpfsToScrub.push(expCpfMatch[1]);
      if (!maskedCpf) {
        maskedCpf = maskCpf(digits);
        interpretationNotes.push(
          `CPF detectado no material empresarial e mascarado (${maskedCpf}) para proteção de dados pessoais.`
        );
      }
    }
  }

  const cpfMatches = combinedCorpus.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || [];
  for (const candidate of cpfMatches) {
    const digits = candidate.replace(/\D/g, '');
    const isInsideCnpj = cnpjs.some((c) => c.includes(digits));
    if (!isInsideCnpj && isValidCpfDigits(digits)) {
      rawCpfsToScrub.push(candidate);
      if (!maskedCpf) {
        maskedCpf = maskCpf(digits);
        interpretationNotes.push(
          `CPF detectado no material empresarial e mascarado (${maskedCpf}) para proteção de dados pessoais.`
        );
      }
    }
  }

  // Phones & WhatsApp
  const whatsapps: string[] = [];
  const waMatches = combinedCorpus.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?[^ \n]*phone=)(\d{10,14})/gi);
  for (const m of waMatches) {
    if (m[1] && !whatsapps.includes(m[1])) whatsapps.push(m[1]);
  }

  const phones: string[] = [];
  const phoneMatches =
    combinedCorpus.match(/(?:\+?55\s?)?\(?\d{2}\)?\s?(?:9\d{4}|\d{4})[-.\s]?\d{4}/g) || [];
  for (const p of phoneMatches) {
    const digits = p.replace(/\D/g, '');
    // Skip if digits match part of a CNPJ
    if (cnpjs.some((c) => c.includes(digits))) continue;
    if (digits.length >= 10 && digits.length <= 13) {
      const clean = p.replace(/\s+/g, ' ').trim();
      if (!phones.includes(clean)) phones.push(clean);
      if (/whatsapp|zap|wpp/i.test(combinedCorpus) && !whatsapps.includes(digits)) {
        whatsapps.push(digits);
      }
    }
  }

  // Emails
  const emails: string[] = [];
  const emailMatches = combinedCorpus.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
  for (const e of emailMatches) {
    if (!emails.includes(e.toLowerCase())) emails.push(e.toLowerCase());
  }

  // Instagram handles (@handle)
  const instagramHandles: string[] = [];
  const handleMatches = combinedCorpus.match(/(?:^|\s)@([a-zA-Z0-9._]{2,30})\b/g) || [];
  for (const h of handleMatches) {
    const cleanHandle = h.trim().replace(/^@/, '');
    if (cleanHandle && !instagramHandles.includes(cleanHandle)) {
      instagramHandles.push(cleanHandle);
    }
  }

  // Addresses & City/UF
  const addresses: string[] = [];
  const addrRegex =
    /(?:Rua|R\.|Avenida|Av\.|Alameda|Praça|Travessa|Rodovia|Estrada|Quadra|Setor|Largo)\s+[^\n]{8,110}/gi;
  const addrMatches = combinedCorpus.match(addrRegex) || [];
  for (const a of addrMatches) {
    const cleaned = a.replace(/\s+/g, ' ').trim();
    if (!addresses.includes(cleaned)) addresses.push(cleaned);
  }

  const cityStates: string[] = [];
  const cityMatch = combinedCorpus.match(
    /\b([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|das|dos|[A-ZÀ-Ú][a-zà-ú]+)){0,3})\s*[-/,]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/g
  );
  if (cityMatch) {
    for (const c of cityMatch) {
      const cleaned = c.replace(/\s+/g, ' ').trim();
      if (!cityStates.includes(cleaned)) cityStates.push(cleaned);
    }
  }

  // Hours
  let hours: string | null = null;
  const hoursMatch = combinedCorpus.match(
    /(?:Horário(?:\s+de\s+funcionamento)?\s*:?\s*[^\n]{6,80}|(?:Seg(?:unda)?|Ter|Qua|Qui|Sex|Sáb|Dom)[^\n]{0,30}\d{1,2}[:h]\d{2}[^\n]{0,35}|Aberto\s+24\s+horas|Fecha\s+às\s+\d{1,2}[:h]\d{2})/i
  );
  if (hoursMatch?.[0]) {
    hours = hoursMatch[0].replace(/^Horário(?:\s+de\s+funcionamento)?\s*:?\s*/i, '').trim();
  }

  // Razão Social & Nome Comercial / Fantasia
  let legalName: string | null = null;
  let businessName: string | null = null;
  let segmentHint: string | null = null;

  const legalMatch = combinedCorpus.match(
    /(?:Razão\s+Social|Nome\s+Empresarial)\s*:?\s*([^\n]{3,90})/i
  );
  if (legalMatch?.[1]) {
    legalName = legalMatch[1].trim();
  } else {
    const suffixMatch = combinedCorpus.match(
      /^([A-ZÀ-Ú0-9][^\n]{3,75}\b(?:LTDA|S\/A|S\.A\.|EIRELI|ME|EPP))\b/im
    );
    if (suffixMatch?.[1]) {
      legalName = suffixMatch[1].trim();
    }
  }

  const fantasyMatch = combinedCorpus.match(
    /(?:Nome\s+Fantasia|Nome\s+Comercial|Empresa|Estabelecimento|Loja)\s*:?\s*([^\n]{2,80})/i
  );
  if (fantasyMatch?.[1]) {
    businessName = fantasyMatch[1].trim();
  }

  const segmentMatch = combinedCorpus.match(
    /(?:Segmento|Ramo|Categoria|Atividade(?:\s+principal)?)\s*:?\s*([^\n]{3,80})/i
  );
  if (segmentMatch?.[1]) {
    segmentHint = segmentMatch[1].trim();
  }

  // Contextual line inference (e.g., copied Google / Google Maps block or plain company name)
  if (!businessName) {
    const lines = combinedCorpus
      .split(/\r?\n/)
      .map(cleanLineCandidate)
      .filter((l) => l.length >= 2 && l.length <= 90);

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (GOOGLE_UI_NOISE.has(lower)) continue;
      if (/^\[(?:imagem|documento|arquivo):/i.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;
      if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(line)) continue;
      if (/^\d{11,14}$/.test(line.replace(/\D/g, '')) && line.replace(/[\d.\-/\s()]/g, '').length === 0) continue;
      if (/^\d[,.]\d\s*\(\d/.test(line)) continue; // rating line "4,8 (1.204)"
      if (/^(?:Rua|R\.|Av\.|Avenida|CEP|Tel|Telefone|WhatsApp|CNPJ|CPF|Horário|Endereço|Site|Instagram|Facebook)\b/i.test(line)) continue;
      if (/^@[a-zA-Z0-9._]+$/.test(line)) continue;

      // Strip inline CNPJs, CPFs, URLs and trailing rating/location suffixes common in Google snippets
      let candidate = line
        .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, ' ')
        .replace(/\b(?:CPF\s*:?\s*)?\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/gi, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s*[-|·•]\s*(Google Maps|Pesquisa Google|Instagram|Facebook).*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      for (const rawCpf of rawCpfsToScrub) {
        candidate = candidate.split(rawCpf).join(' ').replace(/\bCPF\s*:?/gi, ' ').replace(/\s+/g, ' ').trim();
      }
      if (candidate.length >= 2) {
        businessName = candidate;
        break;
      }
    }
  }

  if (businessName && rawCpfsToScrub.length > 0) {
    for (const rawCpf of rawCpfsToScrub) {
      businessName = businessName.split(rawCpf).join(' ').replace(/\bCPF\s*:?/gi, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  if (legalName && rawCpfsToScrub.length > 0) {
    for (const rawCpf of rawCpfsToScrub) {
      legalName = legalName.split(rawCpf).join(' ').replace(/\bCPF\s*:?/gi, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!businessName && legalName) {
    businessName = legalName;
  }

  // Determine source summary
  const detectedParts: string[] = [];
  if (cnpjs.length > 0) detectedParts.push(`CNPJ ${formatCnpjDigits(cnpjs[0])}`);
  if (urls.length > 0) detectedParts.push(`${urls.length} link(s)`);
  if (params.ocrText) detectedParts.push('texto de imagem (OCR)');
  if (params.documentText) detectedParts.push('documento');
  if (businessName) detectedParts.push(`nome "${businessName}"`);
  if (phones.length > 0) detectedParts.push('telefone');
  if (addresses.length > 0) detectedParts.push('endereço');

  const sourceSummary =
    detectedParts.length > 0
      ? `Material interpretado: ${detectedParts.join(', ')}`
      : 'Entrada textual livre';

  const hasSufficientSignal = Boolean(
    urls.length > 0 ||
      cnpjs.length > 0 ||
      businessName ||
      legalName ||
      instagramHandles.length > 0 ||
      phones.length > 0 ||
      addresses.length > 0
  );

  return {
    rawText: params.rawText,
    combinedCorpus,
    ocrText: params.ocrText,
    documentText: params.documentText,
    urls,
    cnpjs,
    maskedCpf,
    phones,
    whatsapps,
    emails,
    instagramHandles,
    addresses,
    cityStates,
    hours,
    businessName,
    legalName,
    segmentHint,
    sourceSummary,
    hasSufficientSignal,
    interpretationNotes,
    limitations,
  };
}
