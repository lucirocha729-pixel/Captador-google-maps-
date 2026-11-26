export type VerificationStatus = 'confirmed' | 'unconfirmed' | 'not_found';

export interface VerifiedSource {
  title: string;
  url: string;
  sourceType: 'google_maps' | 'web' | 'cnpj_api' | 'social' | 'official_site';
}

export interface SocialLinks {
  googleMapsUrl: string;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin?: string | null;
}

export interface CompanyProfile {
  name: string;
  legalName?: string | null;
  cnpj?: string | null;
  sourceOrigin?: string;
  category: string;
  address: string;
  phone: string;
  whatsapp?: string | null;
  hours: string;
  locationSummary: string;
  productsAndServices: string[];
  reviewsAndDifferentiators: string;
  socialLinks: SocialLinks;
  visualReferences: string;
  identityAndPositioning: string;
  verifiedSources: VerifiedSource[];
  limitations: string[];
  fieldStatuses?: Record<string, VerificationStatus>;
}

export interface ColorSwatch {
  name: string;
  hex: string;
  role: string;
  usage: string;
}

export interface ScreenBlueprint {
  id: string;
  name: string;
  route: string;
  purpose: string;
  layoutStructure: string;
  keyComponents: string[];
  primaryButtons: string[];
  userInteractions: string[];
}

export interface ButtonFeatureSpec {
  label: string;
  action: string;
  screenLocation: string;
  businessValue: string;
}

export interface RecommendedIntegration {
  name: string;
  category: string;
  purpose: string;
  costTier: string;
}

export interface AppArchitecture {
  conceptAndObjective: string;
  targetAudience: {
    primaryPersona: string;
    secondaryPersona: string;
    painPoints: string[];
    mobileHabits: string;
  };
  visualIdentity: {
    styleDirection: string;
    atmosphere: string;
    brandVoice: string;
    motif3D: string;
  };
  colorPalette: ColorSwatch[];
  typography: {
    displayFont: string;
    bodyFont: string;
    monoFont: string;
    rationale: string;
  };
  style3DAndEffects: {
    depthSystem: string;
    lightingAndShadows: string;
    neonAndAccentTreatment: string;
    microInteractions: string;
    buttonStyle: string;
  };
  screens: ScreenBlueprint[];
  buttonsAndFeatures: ButtonFeatureSpec[];
  navigationAndUX: {
    navigationPattern: string;
    userFlowSteps: string[];
    accessibilityNotes: string;
  };
  recommendedIntegrations: RecommendedIntegration[];
  whatsappAndSocialStrategy: {
    whatsappFlow: string;
    prefilledMessageTemplate: string;
    instagramFunnel: string;
    facebookAndLocalSeo: string;
    retentionTactics: string[];
  };
}

export interface BlueprintGenerationMeta {
  researchId: string;
  generationMode: 'local' | 'local_fallback' | 'gemini_enriched';
  reusedResearch: boolean;
  apiNotice?: AnalysisErrorPayload | null;
}

export interface ScannerBlueprintResult {
  analyzedAt: string;
  originalInputUrl: string;
  resolvedMapsUrl: string;
  companyProfile: CompanyProfile;
  architecture: AppArchitecture;
  executiveReportMarkdown: string;
  finalBuildPrompt: string;
  meta?: BlueprintGenerationMeta;
}

export interface AnalysisStageEvent {
  stage: string;
  detail: string;
}

export interface CollectedResearchData {
  originalInputUrl: string;
  resolvedMapsUrl: string;
  sourceOrigin?: string;
  inputSummary?: string;
  ocrText?: string | null;
  extractedUrls?: string[];
  maskedCpf?: string | null;
  placeName: string | null;
  legalName?: string | null;
  cnpj?: string | null;
  address?: string | null;
  cityState?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  hours?: string | null;
  segment?: string | null;
  productsAndServices?: string[];
  reviewsSummary?: string | null;
  visualReferences?: string | null;
  website?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
  googleMapsUrl?: string | null;
  queryHint: string | null;
  latLng: { latitude: number; longitude: number } | null;
  metaTitle: string | null;
  metaDescription: string | null;
  verifiedSources: VerifiedSource[];
  fieldStatuses?: Record<string, VerificationStatus>;
  limitations?: string[];
  researchNotes?: string[];
  capturedAt: string;
}

export interface AnalysisErrorPayload {
  status: number;
  code: 'RATE_LIMITED' | 'AUTH_ERROR' | 'INVALID_INPUT' | 'UPSTREAM_ERROR';
  message: string;
  collectedData?: CollectedResearchData;
}



