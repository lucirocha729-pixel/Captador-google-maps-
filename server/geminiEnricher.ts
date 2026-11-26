import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  AnalysisErrorPayload,
  CollectedResearchData,
  CompanyProfile,
  ScannerBlueprintResult,
} from '../src/types/blueprint.ts';
import {
  renderExecutiveReportMarkdown,
  sanitizeArchitecture,
} from './blueprintGenerator.ts';

const MODEL_ID = 'gemini-4-hydrogen';
const GEMINI_TIMEOUT_MS = 20000;

export function createOptionalGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function asNonEmptyString(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

function asStringArray(val: unknown, fallback: string[]): string[] {
  if (!Array.isArray(val)) return fallback;
  const cleaned = val
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
  return cleaned.length > 0 ? cleaned : fallback;
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('A resposta opcional do Gemini não retornou JSON válido.');
  }
}

export function classifyGeminiEnrichmentError(
  error: unknown,
  collectedData?: CollectedResearchData
): AnalysisErrorPayload {
  const errMsg = error instanceof Error ? error.message : String(error);
  const lower = errMsg.toLowerCase();

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('429') ||
    lower.includes('quota')
  ) {
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'Cota/limite da API Gemini atingido (429 RESOURCE_EXHAUSTED). Os dados coletados foram preservados e o projeto arquitetônico completo + prompt final foram gerados localmente sem interrupções.',
      collectedData,
    };
  }

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return {
      status: 401,
      code: 'AUTH_ERROR',
      message:
        'Chave da API Gemini ausente ou inválida. Os dados da empresa foram preservados e o projeto arquitetônico foi gerado localmente sem interrupções.',
      collectedData,
    };
  }

  return {
    status: 503,
    code: 'UPSTREAM_ERROR',
    message:
      'API Gemini indisponível ou sem conexão no momento. Todos os dados da empresa foram preservados e o projeto completo foi concluído pelo motor local.',
    collectedData,
  };
}

export type OptionalEnrichmentOutcome =
  | { ok: true; result: ScannerBlueprintResult }
  | { ok: false; notice: AnalysisErrorPayload };

export async function enrichBlueprintWithGemini(
  ai: GoogleGenAI | null,
  collected: CollectedResearchData,
  localBaseline: ScannerBlueprintResult
): Promise<OptionalEnrichmentOutcome> {
  if (!ai) {
    return {
      ok: false,
      notice: {
        status: 401,
        code: 'AUTH_ERROR',
        message:
          'API Gemini não configurada. O projeto arquitetônico completo e o prompt final foram gerados pelo motor local independente.',
        collectedData: collected,
      },
    };
  }

  const consolidatedPrompt = [
    'Você é o núcleo opcional de refinamento do VIRA SCANNER 3D (arquiteto de apps, UI/UX, diretor de arte, branding, estrategista mobile).',
    'REGRA PRINCIPAL: Refine exclusivamente o projeto arquitetônico (11 pilares) e O ÚNICO PROMPT FINAL DE CONSTRUÇÃO para esta empresa. Nunca construa o app nem invente dados não presentes abaixo.',
    '',
    'DADOS VERIFICADOS DA EMPRESA:',
    `- Origem: ${collected.inputSummary || collected.sourceOrigin || 'Material enviado'}`,
    `- Nome: ${localBaseline.companyProfile.name} (${collected.fieldStatuses?.name || 'unconfirmed'})`,
    collected.legalName ? `- Razão social: ${collected.legalName}` : '',
    collected.cnpj ? `- CNPJ: ${collected.cnpj}` : '',
    collected.segment ? `- Segmento: ${collected.segment}` : '',
    collected.address ? `- Endereço: ${collected.address}` : '- Endereço: Não localizado',
    collected.phone ? `- Telefone: ${collected.phone}` : '- Telefone: Não localizado',
    collected.whatsapp ? `- WhatsApp: ${collected.whatsapp}` : '',
    collected.hours ? `- Horários: ${collected.hours}` : '- Horários: Não localizados',
    collected.website ? `- Site: ${collected.website}` : '',
    collected.instagram ? `- Instagram: ${collected.instagram}` : '',
    collected.facebook ? `- Facebook: ${collected.facebook}` : '',
    collected.googleMapsUrl ? `- Maps: ${collected.googleMapsUrl}` : '',
    collected.metaDescription ? `- Descrição pública: ${collected.metaDescription}` : '',
    collected.limitations && collected.limitations.length > 0
      ? `- Limitações: ${collected.limitations.slice(0, 4).join(' | ')}`
      : '',
    '',
    'Retorne EXCLUSIVAMENTE um JSON válido em Português do Brasil com as chaves:',
    JSON.stringify({
      companyProfile: {
        category: localBaseline.companyProfile.category,
        productsAndServices: localBaseline.companyProfile.productsAndServices,
        reviewsAndDifferentiators: localBaseline.companyProfile.reviewsAndDifferentiators,
        identityAndPositioning: localBaseline.companyProfile.identityAndPositioning,
      },
      architecture: localBaseline.architecture,
      finalBuildPrompt:
        'string (prompt único completo e autocontido com os dados reais, paleta, tipografia, estética 3D, telas, botões e requisitos técnicos)',
    }),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const geminiPromise = ai.models.generateContent({
      model: MODEL_ID,
      contents: consolidatedPrompt,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tempo limite da API Gemini atingido (20s).')), GEMINI_TIMEOUT_MS)
    );

    const response = await Promise.race([geminiPromise, timeoutPromise]);
    const parsed = extractJsonObject(response.text || '') as Partial<ScannerBlueprintResult>;
    const rawProfile = parsed.companyProfile;

    const mergedProfile: CompanyProfile = {
      ...localBaseline.companyProfile,
      category: asNonEmptyString(rawProfile?.category, localBaseline.companyProfile.category),
      reviewsAndDifferentiators: asNonEmptyString(
        rawProfile?.reviewsAndDifferentiators,
        localBaseline.companyProfile.reviewsAndDifferentiators
      ),
      identityAndPositioning: asNonEmptyString(
        rawProfile?.identityAndPositioning,
        localBaseline.companyProfile.identityAndPositioning
      ),
      productsAndServices: asStringArray(
        rawProfile?.productsAndServices,
        localBaseline.companyProfile.productsAndServices
      ),
      legalName: collected.legalName ?? null,
      cnpj: collected.cnpj ?? null,
      whatsapp: collected.whatsapp ?? null,
      sourceOrigin: collected.sourceOrigin,
      fieldStatuses: collected.fieldStatuses,
      limitations: localBaseline.companyProfile.limitations,
      socialLinks: localBaseline.companyProfile.socialLinks,
      verifiedSources: collected.verifiedSources,
    };

    const mergedArchitecture = sanitizeArchitecture(parsed.architecture, localBaseline.architecture);
    const executiveReportMarkdown = renderExecutiveReportMarkdown(
      collected,
      mergedProfile,
      mergedArchitecture
    );

    return {
      ok: true,
      result: {
        analyzedAt: new Date().toISOString(),
        originalInputUrl: collected.originalInputUrl,
        resolvedMapsUrl: localBaseline.resolvedMapsUrl,
        companyProfile: mergedProfile,
        architecture: mergedArchitecture,
        executiveReportMarkdown,
        finalBuildPrompt:
          typeof parsed.finalBuildPrompt === 'string' && parsed.finalBuildPrompt.trim()
            ? parsed.finalBuildPrompt
            : localBaseline.finalBuildPrompt,
        meta: localBaseline.meta
          ? { ...localBaseline.meta, generationMode: 'gemini_enriched', apiNotice: null }
          : undefined,
      },
    };
  } catch (error) {
    return {
      ok: false,
      notice: classifyGeminiEnrichmentError(error, collected),
    };
  }
}
