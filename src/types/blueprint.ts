export interface VerifiedSource {
  title: string;
  url: string;
  sourceType: 'google_maps' | 'web';
}

export interface SocialLinks {
  googleMapsUrl: string;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
}

export interface CompanyProfile {
  name: string;
  category: string;
  address: string;
  phone: string;
  hours: string;
  locationSummary: string;
  productsAndServices: string[];
  reviewsAndDifferentiators: string;
  socialLinks: SocialLinks;
  visualReferences: string;
  identityAndPositioning: string;
  verifiedSources: VerifiedSource[];
  limitations: string[];
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

export interface ScannerBlueprintResult {
  analyzedAt: string;
  originalInputUrl: string;
  resolvedMapsUrl: string;
  companyProfile: CompanyProfile;
  architecture: AppArchitecture;
  executiveReportMarkdown: string;
  finalBuildPrompt: string;
}

export interface AnalysisStageEvent {
  stage: string;
  detail: string;
}

export interface CollectedResearchData {
  originalInputUrl: string;
  resolvedMapsUrl: string;
  placeName: string | null;
  queryHint: string | null;
  latLng: { latitude: number; longitude: number } | null;
  metaTitle: string | null;
  metaDescription: string | null;
  verifiedSources: VerifiedSource[];
  capturedAt: string;
}

export interface AnalysisErrorPayload {
  status: number;
  code: 'RATE_LIMITED' | 'AUTH_ERROR' | 'INVALID_INPUT' | 'UPSTREAM_ERROR';
  message: string;
  collectedData?: CollectedResearchData;
}

