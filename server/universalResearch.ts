import net from 'node:net';
import type {
  CollectedResearchData,
  VerificationStatus,
  VerifiedSource,
} from '../src/types/blueprint.ts';

export type SourceOrigin =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'google_maps'
  | 'cnpj_portal'
  | 'review_portal'
  | 'directory'
  | 'website';

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface PageFetchResult {
  requestedUrl: string;
  resolvedUrl: string;
  status: number;
  ok: boolean;
  blocked: boolean;
  html: string;
  error?: string;
}

interface ExtractedPageFacts {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  businessName: string | null;
  legalName: string | null;
  cnpjs: string[];
  phones: string[];
  whatsapps: string[];
  emails: string[];
  address: string | null;
  cityState: string | null;
  hours: string | null;
  segment: string | null;
  productsAndServices: string[];
  instagrams: string[];
  facebooks: string[];
  linkedins: string[];
  googleMapsUrls: string[];
  externalWebsites: string[];
  visibleTextSample: string;
}

interface CnpjRecord {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  address: string | null;
  cityState: string | null;
  phone: string | null;
  email: string | null;
  segment: string | null;
  sourceTitle: string;
  sourceUrl: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'para',
  'com',
  'ltda',
  'me',
  'epp',
  'eireli',
  'sa',
  's/a',
  'ss',
  'comercio',
  'servicos',
  'servico',
  'oficial',
  'brasil',
  'br',
  'site',
  'instagram',
  'facebook',
  'linkedin',
  'cnpj',
  'google',
  'maps',
]);

export function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const [a, b] = lower.split('.').map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  if (ipVersion === 6) {
    if (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'n/a') {
    return null;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return u.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function isValidCnpj(rawDigits: string): boolean {
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

export function formatCnpj(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function tokenizeName(input: string | null | undefined): string[] {
  if (!input) return [];
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');

  return Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    )
  );
}

function extractMetaTag(html: string, attrName: string, attrValue: string): string | null {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]*${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const patternB = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escaped}["'][^>]*>`,
    'i'
  );
  const match = html.match(patternA) || html.match(patternB);
  if (!match?.[1]) return null;
  const decoded = decodeHtmlEntities(match[1]);
  const lower = decoded.toLowerCase();
  if (
    !decoded ||
    lower === 'google maps' ||
    lower === 'instagram' ||
    lower === 'facebook' ||
    lower === 'linkedin' ||
    lower.includes('find local businesses, view maps and get driving directions') ||
    lower.includes('encontre empresas locais, visualize mapas e obtenha rotas') ||
    lower.includes('create an account or log in to instagram') ||
    lower.includes('faça login no facebook') ||
    lower.includes('entre ou cadastre-se')
  ) {
    return null;
  }
  return decoded;
}

export function classifySourceUrl(rawUrl: string): {
  origin: SourceOrigin;
  domain: string;
  cnpjFromUrl: string | null;
  instagramHandle: string | null;
  facebookSlug: string | null;
  linkedinSlug: string | null;
  mapsPlaceName: string | null;
  mapsCoords: { latitude: number; longitude: number } | null;
  mapsQueryHint: string | null;
  slugHint: string | null;
} {
  const u = new URL(rawUrl);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;
  const lowerPath = path.toLowerCase();

  let cnpjFromUrl: string | null = null;
  const rawCnpjMatches = decodeURIComponent(rawUrl).match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || [];
  for (const m of rawCnpjMatches) {
    const digits = m.replace(/\D/g, '');
    if (isValidCnpj(digits)) {
      cnpjFromUrl = digits;
      break;
    }
  }

  let origin: SourceOrigin = 'website';
  let instagramHandle: string | null = null;
  let facebookSlug: string | null = null;
  let linkedinSlug: string | null = null;
  let mapsPlaceName: string | null = null;
  let mapsCoords: { latitude: number; longitude: number } | null = null;
  let mapsQueryHint: string | null = null;
  let slugHint: string | null = null;

  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    origin = 'instagram';
    const seg = path.split('/').filter(Boolean)[0];
    const ignored = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'about']);
    if (seg && !ignored.has(seg.toLowerCase())) {
      instagramHandle = seg.replace(/^@/, '');
      slugHint = instagramHandle.replace(/[._-]+/g, ' ');
    }
  } else if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    origin = 'facebook';
    const seg = path.split('/').filter(Boolean)[0];
    const ignored = new Set(['sharer', 'login', 'groups', 'watch', 'marketplace', 'events', 'pages', 'profile.php']);
    if (seg && !ignored.has(seg.toLowerCase())) {
      facebookSlug = seg;
      slugHint = seg.replace(/[._-]+/g, ' ');
    } else if (lowerPath.includes('/pages/')) {
      const segs = path.split('/').filter(Boolean);
      if (segs[1]) {
        slugHint = segs[1].replace(/[-_]+/g, ' ');
      }
    }
  } else if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    origin = 'linkedin';
    const companyMatch = path.match(/\/company\/([^/]+)/i);
    if (companyMatch?.[1]) {
      linkedinSlug = companyMatch[1];
      slugHint = linkedinSlug.replace(/[-_]+/g, ' ');
    }
  } else if (
    host === 'maps.app.goo.gl' ||
    host === 'g.page' ||
    host === 'share.google' ||
    (host === 'goo.gl' && lowerPath.startsWith('/maps')) ||
    host === 'maps.google.com' ||
    host.startsWith('maps.google.') ||
    (host.includes('google.') && lowerPath.startsWith('/maps'))
  ) {
    origin = 'google_maps';
    const placeMatch = path.match(/\/maps\/place\/([^/]+)/);
    if (placeMatch?.[1]) {
      mapsPlaceName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
      slugHint = mapsPlaceName;
    }
    const coordMatch = rawUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch?.[1] && coordMatch?.[2]) {
      const latitude = Number(coordMatch[1]);
      const longitude = Number(coordMatch[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        mapsCoords = { latitude, longitude };
      }
    }
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q) {
      mapsQueryHint = q.trim();
      if (!slugHint) slugHint = mapsQueryHint;
    }
  } else if (
    host.includes('cnpj') ||
    host.includes('casadosdados') ||
    host.includes('econodata') ||
    host.includes('receita.fazenda') ||
    host.includes('receitaws') ||
    host.includes('minhareceita') ||
    host.includes('serasa') ||
    host.includes('speedio') ||
    host.includes('biz') ||
    cnpjFromUrl !== null
  ) {
    origin = 'cnpj_portal';
    const segs = path.split('/').filter(Boolean);
    const nonNumeric = segs.find((s) => /[a-z]{3,}/i.test(s) && !/^(cnpj|empresa|solucao|consulta)$/i.test(s));
    if (nonNumeric) {
      slugHint = decodeURIComponent(nonNumeric).replace(/[-_]+/g, ' ').replace(/\d{8,14}/g, '').trim();
    }
  } else if (
    host.includes('reclameaqui') ||
    host.includes('trustpilot') ||
    host.includes('tripadvisor') ||
    host.includes('yelp')
  ) {
    origin = 'review_portal';
    const segs = path.split('/').filter(Boolean);
    const candidate = segs[segs.length - 1] || segs[0];
    if (candidate && candidate.toLowerCase() !== 'empresa') {
      slugHint = candidate.replace(/[-_]+/g, ' ');
    }
  } else if (
    host.includes('guiamais') ||
    host.includes('telelistas') ||
    host.includes('apontador') ||
    host.includes('solutudo') ||
    host.includes('listamais') ||
    host.includes('catalogodeempresas') ||
    host.includes('ifood')
  ) {
    origin = 'directory';
    const segs = path.split('/').filter(Boolean);
    const reversed = [...segs].reverse();
    const candidate = reversed.find(
      (s) =>
        /[a-z]{3,}/i.test(s) &&
        !/^(empresa|empresas|busca|sp|rj|mg|rs|pr|sc|ba|df)$/i.test(s) &&
        !/-[a-z]{2}$/i.test(s)
    ) || reversed[0];
    if (candidate) {
      slugHint = decodeURIComponent(candidate).replace(/[-_]+/g, ' ');
    }
  } else {
    origin = 'website';
    const rootPart = host.split('.')[0];
    if (rootPart && rootPart.length >= 2) {
      slugHint = rootPart.replace(/[-_]+/g, ' ');
    }
  }

  return {
    origin,
    domain: host,
    cnpjFromUrl,
    instagramHandle,
    facebookSlug,
    linkedinSlug,
    mapsPlaceName,
    mapsCoords,
    mapsQueryHint,
    slugHint,
  };
}

async function safeFetchPublicHtml(rawUrl: string): Promise<PageFetchResult> {
  let currentUrl = rawUrl;
  const maxHops = 5;

  for (let hop = 0; hop < maxHops; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return {
        requestedUrl: rawUrl,
        resolvedUrl: currentUrl,
        status: 400,
        ok: false,
        blocked: false,
        html: '',
        error: 'URL inválida durante redirecionamento.',
      };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        requestedUrl: rawUrl,
        resolvedUrl: currentUrl,
        status: 400,
        ok: false,
        blocked: false,
        html: '',
        error: 'Protocolo não permitido.',
      };
    }
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      return {
        requestedUrl: rawUrl,
        resolvedUrl: currentUrl,
        status: 403,
        ok: false,
        blocked: true,
        html: '',
        error: 'Endereço de rede privado bloqueado por segurança.',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const resp = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: BROWSER_HEADERS,
      });

      const location = resp.headers.get('location');
      if (location && resp.status >= 300 && resp.status < 400) {
        const nextUrl = new URL(location, currentUrl).toString();
        const lowerNext = nextUrl.toLowerCase();
        if (
          lowerNext.includes('/accounts/login') ||
          lowerNext.includes('login.php') ||
          lowerNext.includes('/login/') ||
          lowerNext.includes('checkpoint/')
        ) {
          return {
            requestedUrl: rawUrl,
            resolvedUrl: rawUrl,
            status: resp.status,
            ok: false,
            blocked: true,
            html: '',
            error: 'A plataforma redirecionou para área autenticada/login.',
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      const html = contentType.includes('text/html') || contentType.includes('application/xhtml')
        ? (await resp.text()).slice(0, 260000)
        : '';

      const isBlocked = resp.status === 401 || resp.status === 403 || resp.status === 429;
      return {
        requestedUrl: rawUrl,
        resolvedUrl: resp.url || currentUrl,
        status: resp.status,
        ok: resp.ok,
        blocked: isBlocked,
        html,
        error: resp.ok ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        requestedUrl: rawUrl,
        resolvedUrl: currentUrl,
        status: 0,
        ok: false,
        blocked: false,
        html: '',
        error: err instanceof Error ? err.message : 'Falha de conexão ao acessar página.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    requestedUrl: rawUrl,
    resolvedUrl: currentUrl,
    status: 310,
    ok: false,
    blocked: false,
    html: '',
    error: 'Excesso de redirecionamentos.',
  };
}

function extractFromHtml(html: string, pageUrl: string): ExtractedPageFacts {
  const facts: ExtractedPageFacts = {
    title: null,
    metaTitle: null,
    metaDescription: null,
    businessName: null,
    legalName: null,
    cnpjs: [],
    phones: [],
    whatsapps: [],
    emails: [],
    address: null,
    cityState: null,
    hours: null,
    segment: null,
    productsAndServices: [],
    instagrams: [],
    facebooks: [],
    linkedins: [],
    googleMapsUrls: [],
    externalWebsites: [],
    visibleTextSample: '',
  };

  if (!html) return facts;

  facts.metaTitle =
    extractMetaTag(html, 'property', 'og:title') ||
    extractMetaTag(html, 'property', 'og:site_name') ||
    extractMetaTag(html, 'itemprop', 'name') ||
    null;

  facts.metaDescription =
    extractMetaTag(html, 'property', 'og:description') ||
    extractMetaTag(html, 'name', 'description') ||
    null;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const t = decodeHtmlEntities(titleMatch[1]);
    if (
      t &&
      !/^(google maps|instagram|facebook|just a moment|access denied|attention required|error|acesso bloqueado|404|403|not found|página não encontrada|arquivo ou pasta não encontrado)/i.test(
        t
      )
    ) {
      facts.title = t;
    }
  }

  const rawTitleForName = facts.metaTitle || facts.title;
  if (rawTitleForName) {
    const cleanedName = rawTitleForName
      .replace(/\s*\(@[^)]+\)\s*•\s*Fotos e vídeos do Instagram/gi, '')
      .replace(/\s*•\s*Instagram photos and videos/gi, '')
      .replace(/\s*[-|•]\s*(Instagram|Facebook|LinkedIn|Google Maps|Reclame AQUI|Casa dos Dados|CNPJ Biz|Econodata|GuiaMais|Apontador).*$/i, '')
      .trim();
    if (
      cleanedName &&
      cleanedName.length >= 2 &&
      cleanedName.length <= 100 &&
      !/^(error|acesso bloqueado|not found|404|403|arquivo ou pasta)/i.test(cleanedName)
    ) {
      facts.businessName = cleanedName;
    }
  }

  // Parse JSON-LD structured data
  const ldMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const n = node as Record<string, unknown>;
        const nodeType = String(n['@type'] || '');
        if (/Organization|LocalBusiness|Store|Restaurant|FoodEstablishment|Museum|Medical|Place/i.test(nodeType)) {
          if (typeof n.name === 'string' && !facts.businessName) facts.businessName = n.name.trim();
          if (typeof n.legalName === 'string' && !facts.legalName) facts.legalName = n.legalName.trim();
          if (typeof n.telephone === 'string') facts.phones.push(n.telephone.trim());
          if (typeof n.email === 'string') facts.emails.push(n.email.trim());
          if (typeof n.openingHours === 'string') facts.hours = n.openingHours.trim();
          if (Array.isArray(n.openingHours)) facts.hours = n.openingHours.join('; ');
          if (typeof n.url === 'string') {
            const u = normalizeHttpUrl(n.url);
            if (u) facts.externalWebsites.push(u);
          }
          if (n.address && typeof n.address === 'object') {
            const addr = n.address as Record<string, unknown>;
            const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
            if (parts.length > 0 && !facts.address) facts.address = parts.join(', ');
            if (typeof addr.addressLocality === 'string' && typeof addr.addressRegion === 'string') {
              facts.cityState = `${addr.addressLocality.trim()} - ${addr.addressRegion.trim()}`;
            }
          }
          if (Array.isArray(n.sameAs)) {
            for (const s of n.sameAs) {
              if (typeof s !== 'string') continue;
              const u = normalizeHttpUrl(s);
              if (!u) continue;
              if (u.includes('instagram.com')) facts.instagrams.push(u);
              else if (u.includes('facebook.com')) facts.facebooks.push(u);
              else if (u.includes('linkedin.com')) facts.linkedins.push(u);
            }
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  // Extract links from hrefs
  const hrefMatches = html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi);
  for (const m of hrefMatches) {
    const u = normalizeHttpUrl(m[1]);
    if (!u) continue;
    const lower = u.toLowerCase();
    if (lower.includes('instagram.com/') && !lower.includes('/p/') && !lower.includes('/reel/')) {
      facts.instagrams.push(u.split('?')[0]);
    } else if (lower.includes('facebook.com/') && !lower.includes('sharer')) {
      facts.facebooks.push(u.split('?')[0]);
    } else if (lower.includes('linkedin.com/company/')) {
      facts.linkedins.push(u.split('?')[0]);
    } else if (lower.includes('google.com/maps') || lower.includes('maps.app.goo.gl')) {
      facts.googleMapsUrls.push(u);
    } else if (lower.includes('wa.me/') || lower.includes('api.whatsapp.com/send')) {
      const waDigits = u.match(/(?:wa\.me\/|phone=)(\d{10,14})/);
      if (waDigits?.[1]) facts.whatsapps.push(waDigits[1]);
    }
  }

  const text = stripTags(html);
  facts.visibleTextSample = text.slice(0, 4000);

  // Validated CNPJs in visible text
  const cnpjMatches = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g) || [];
  for (const c of cnpjMatches) {
    const digits = c.replace(/\D/g, '');
    if (isValidCnpj(digits) && !facts.cnpjs.includes(digits)) {
      facts.cnpjs.push(digits);
    }
  }

  // Phones in text
  const phoneMatches = text.match(/(?:\+?55\s?)?\(?\d{2}\)?\s?(?:9\d{4}|\d{4})[-.\s]?\d{4}/g) || [];
  for (const p of phoneMatches.slice(0, 6)) {
    const clean = p.replace(/\s+/g, ' ').trim();
    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !facts.phones.includes(clean)) {
      facts.phones.push(clean);
    }
  }

  // Emails in text
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
  for (const e of emailMatches.slice(0, 4)) {
    if (!e.endsWith('.png') && !e.endsWith('.jpg') && !facts.emails.includes(e)) {
      facts.emails.push(e);
    }
  }

  // Brazilian address + CEP snippet if not found via JSON-LD
  if (!facts.address) {
    const addrMatch = text.match(
      /(?:Rua|Avenida|Av\.|Alameda|Praça|Travessa|Rodovia|Estrada)\s+[^.\n]{8,95}(?:\d{5}-?\d{3})?/i
    );
    if (addrMatch?.[0]) {
      facts.address = addrMatch[0].trim();
    }
  }

  // Deduplicate lists
  facts.instagrams = Array.from(new Set(facts.instagrams));
  facts.facebooks = Array.from(new Set(facts.facebooks));
  facts.linkedins = Array.from(new Set(facts.linkedins));
  facts.googleMapsUrls = Array.from(new Set(facts.googleMapsUrls));
  facts.whatsapps = Array.from(new Set(facts.whatsapps));
  facts.phones = Array.from(new Set(facts.phones));
  facts.emails = Array.from(new Set(facts.emails));

  // Ignore social links belonging to page itself if pageUrl is a social platform or aggregator
  const pageLower = pageUrl.toLowerCase();
  const pageHost = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  if (pageLower.includes('instagram.com')) facts.instagrams = [];
  if (pageLower.includes('facebook.com')) facts.facebooks = [];
  if (isPlatformAggregator(pageHost)) {
    const hostRoot = pageHost.split('.')[0];
    facts.instagrams = facts.instagrams.filter((u) => !u.toLowerCase().includes(hostRoot));
    facts.facebooks = facts.facebooks.filter((u) => !u.toLowerCase().includes(hostRoot));
    facts.externalWebsites = facts.externalWebsites.filter((u) => !u.toLowerCase().includes(hostRoot));
  }

  return facts;
}

async function lookupCnpjPublicData(cnpjDigits: string): Promise<CnpjRecord | null> {
  const clean = cnpjDigits.replace(/\D/g, '');
  if (!isValidCnpj(clean)) return null;

  const tryFetchJson = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
      if (!r.ok) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. BrasilAPI
  const brasil = await tryFetchJson(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
  if (brasil && typeof brasil.razao_social === 'string') {
    const addrParts = [
      [brasil.descricao_tipo_de_logradouro, brasil.logradouro].filter(Boolean).join(' '),
      brasil.numero,
      brasil.complemento,
      brasil.bairro,
      [brasil.municipio, brasil.uf].filter(Boolean).join('/'),
      brasil.cep ? `CEP ${brasil.cep}` : null,
    ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

    return {
      cnpj: formatCnpj(clean),
      legalName: brasil.razao_social.trim(),
      tradeName:
        typeof brasil.nome_fantasia === 'string' && brasil.nome_fantasia.trim()
          ? brasil.nome_fantasia.trim()
          : null,
      address: addrParts.join(', ') || null,
      cityState:
        brasil.municipio && brasil.uf ? `${String(brasil.municipio).trim()} - ${String(brasil.uf).trim()}` : null,
      phone:
        typeof brasil.ddd_telefone_1 === 'string' && brasil.ddd_telefone_1.trim()
          ? brasil.ddd_telefone_1.trim()
          : null,
      email: typeof brasil.email === 'string' && brasil.email.trim() ? brasil.email.trim() : null,
      segment:
        typeof brasil.cnae_fiscal_descricao === 'string' && brasil.cnae_fiscal_descricao.trim()
          ? brasil.cnae_fiscal_descricao.trim()
          : null,
      sourceTitle: `BrasilAPI · Receita Federal (${formatCnpj(clean)})`,
      sourceUrl: `https://brasilapi.com.br/api/cnpj/v1/${clean}`,
    };
  }

  // 2. Fallback: publica.cnpj.ws
  const cnpjWs = await tryFetchJson(`https://publica.cnpj.ws/cnpj/${clean}`);
  if (cnpjWs && typeof cnpjWs.razao_social === 'string') {
    const est = (cnpjWs.estabelecimento || {}) as Record<string, unknown>;
    const cidade = (est.cidade as Record<string, unknown> | undefined)?.nome;
    const estado = (est.estado as Record<string, unknown> | undefined)?.sigla;
    const addrParts = [
      [est.tipo_logradouro, est.logradouro].filter(Boolean).join(' '),
      est.numero,
      est.bairro,
      cidade && estado ? `${cidade}/${estado}` : null,
      est.cep ? `CEP ${est.cep}` : null,
    ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

    const atividade = (est.atividade_principal as Record<string, unknown> | undefined)?.descricao;

    return {
      cnpj: formatCnpj(clean),
      legalName: cnpjWs.razao_social.trim(),
      tradeName:
        typeof est.nome_fantasia === 'string' && est.nome_fantasia.trim()
          ? est.nome_fantasia.trim()
          : null,
      address: addrParts.join(', ') || null,
      cityState: cidade && estado ? `${String(cidade).trim()} - ${String(estado).trim()}` : null,
      phone:
        est.ddd1 && est.telefone1 ? `(${String(est.ddd1)}) ${String(est.telefone1)}` : null,
      email: typeof est.email === 'string' ? est.email.trim() : null,
      segment: typeof atividade === 'string' ? atividade.trim() : null,
      sourceTitle: `CNPJ.ws Dados Públicos (${formatCnpj(clean)})`,
      sourceUrl: `https://publica.cnpj.ws/cnpj/${clean}`,
    };
  }

  return null;
}

function decodeBingTrackingUrl(rawHref: string): string | null {
  const decodedHref = decodeHtmlEntities(rawHref);
  try {
    const u = new URL(decodedHref);
    if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/')) {
      const encodedTarget = u.searchParams.get('u');
      if (encodedTarget && encodedTarget.startsWith('a1')) {
        const b64 = encodedTarget.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const target = Buffer.from(b64, 'base64').toString('utf8');
        return normalizeHttpUrl(target);
      }
    }
    return normalizeHttpUrl(decodedHref);
  } catch {
    return null;
  }
}

async function searchPublicWeb(query: string): Promise<WebSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // 1. Optional Serper API if configured
  if (process.env.SERPER_API_KEY) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: trimmed, gl: 'br', hl: 'pt-br', num: 8 }),
        signal: controller.signal,
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string }>;
        };
        if (Array.isArray(data.organic)) {
          return data.organic
            .map((item) => ({
              title: item.title || '',
              url: normalizeHttpUrl(item.link) || '',
              snippet: item.snippet || '',
            }))
            .filter((x) => Boolean(x.url));
        }
      }
    } catch {
      // Fall through to free search
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Optional Google Custom Search API if configured
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
        process.env.GOOGLE_CSE_API_KEY
      )}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX)}&q=${encodeURIComponent(trimmed)}&num=8`;
      const resp = await fetch(cseUrl, { signal: controller.signal });
      if (resp.ok) {
        const data = (await resp.json()) as {
          items?: Array<{ title?: string; link?: string; snippet?: string }>;
        };
        if (Array.isArray(data.items)) {
          return data.items
            .map((item) => ({
              title: item.title || '',
              url: normalizeHttpUrl(item.link) || '',
              snippet: item.snippet || '',
            }))
            .filter((x) => Boolean(x.url));
        }
      }
    } catch {
      // Fall through to built-in public search
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. Built-in Zero-Key Public Web Search (Bing public HTML search)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}&cc=BR&setlang=pt-BR`;
    const resp = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const hits: WebSearchHit[] = [];
    const blocks = html.matchAll(/<li class=["']b_algo["'][\s\S]*?<\/li>/gi);

    for (const block of blocks) {
      const anchor = block[0].match(/<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor) continue;
      const realUrl = decodeBingTrackingUrl(anchor[1]);
      if (!realUrl) continue;
      const title = stripTags(anchor[2]);
      const pMatch = block[0].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = pMatch?.[1] ? stripTags(pMatch[1]) : '';
      hits.push({ title, url: realUrl, snippet });
      if (hits.length >= 8) break;
    }
    return hits;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function evaluateIdentityMatch(
  anchor: {
    nameTokens: string[];
    cnpj: string | null;
    cityTokens: string[];
    domain: string | null;
    handle: string | null;
  },
  candidateText: string,
  candidateUrl: string,
  candidateCnpj?: string | null
): 'confirmed' | 'unconfirmed' | 'rejected' {
  // Hard conflict check on CNPJ
  if (anchor.cnpj && candidateCnpj) {
    const a = anchor.cnpj.replace(/\D/g, '');
    const b = candidateCnpj.replace(/\D/g, '');
    if (a && b && a !== b) return 'rejected';
    if (a && b && a === b) return 'confirmed';
  }

  const candLower = candidateUrl.toLowerCase();
  if (anchor.domain && !isPlatformAggregator(anchor.domain) && candLower.includes(anchor.domain)) {
    return 'confirmed';
  }
  if (anchor.handle && candLower.includes(`/${anchor.handle.toLowerCase()}`)) {
    return 'confirmed';
  }

  const candTokens = tokenizeName(candidateText);
  if (anchor.nameTokens.length === 0 || candTokens.length === 0) {
    return 'unconfirmed';
  }

  const candSet = new Set(candTokens);
  let matched = 0;
  for (const tok of anchor.nameTokens) {
    if (candSet.has(tok)) matched++;
  }
  const overlap = matched / anchor.nameTokens.length;

  const cityMatched =
    anchor.cityTokens.length > 0 && anchor.cityTokens.some((ct) => candSet.has(ct));

  if (overlap >= 0.7 && (cityMatched || anchor.nameTokens.length >= 2)) {
    return 'confirmed';
  }
  if (overlap >= 0.5 && cityMatched) {
    return 'confirmed';
  }
  if (overlap >= 0.5) {
    return 'unconfirmed';
  }
  return 'rejected';
}

function isPlatformAggregator(domain: string): boolean {
  const lower = domain.toLowerCase();
  return [
    'instagram.com',
    'facebook.com',
    'fb.com',
    'linkedin.com',
    'google.com',
    'maps.app.goo.gl',
    'goo.gl',
    'g.page',
    'cnpj.biz',
    'casadosdados.com.br',
    'econodata.com.br',
    'serasaexperian.com.br',
    'receita.fazenda.gov.br',
    'reclameaqui.com.br',
    'guiamais.com.br',
    'apontador.com.br',
    'telelistas.net',
    'wikipedia.org',
    'youtube.com',
  ].some((agg) => lower === agg || lower.endsWith(`.${agg}`));
}

export async function runUniversalCompanyResearch(
  rawInputUrl: string,
  onProgress?: (stage: string, detail: string) => void
): Promise<CollectedResearchData> {
  const trimmed = rawInputUrl.trim();
  const parsed = new URL(trimmed);
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || isPrivateOrBlockedHost(parsed.hostname)) {
    throw new Error('Endereço de URL inválido ou não permitido.');
  }

  const limitations: string[] = [];
  const researchNotes: string[] = [];
  const verifiedSources: VerifiedSource[] = [];
  const seenUrls = new Set<string>();

  const addSource = (
    title: string,
    url: string | null | undefined,
    sourceType: VerifiedSource['sourceType']
  ) => {
    const clean = normalizeHttpUrl(url);
    if (!clean || seenUrls.has(clean)) return;
    seenUrls.add(clean);
    verifiedSources.push({ title: title.trim() || clean, url: clean, sourceType });
  };

  onProgress?.(
    'Analisando link informado',
    'Identificando domínio, plataforma de origem e parâmetros públicos.'
  );

  const primaryFetch = await safeFetchPublicHtml(trimmed);
  const resolvedUrl = primaryFetch.resolvedUrl || trimmed;
  const classification = classifySourceUrl(resolvedUrl);

  const originLabelMap: Record<SourceOrigin, string> = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    google_maps: 'Google Maps',
    cnpj_portal: 'Consulta CNPJ / Dados Cadastrais',
    review_portal: 'Portal de Avaliações',
    directory: 'Diretório Empresarial',
    website: 'Site Institucional',
  };

  addSource(
    `${originLabelMap[classification.origin]} (Link informado)`,
    resolvedUrl,
    classification.origin === 'google_maps'
      ? 'google_maps'
      : classification.origin === 'website'
        ? 'official_site'
        : classification.origin === 'instagram' ||
            classification.origin === 'facebook' ||
            classification.origin === 'linkedin'
          ? 'social'
          : 'web'
  );

  if (!primaryFetch.ok) {
    if (primaryFetch.blocked) {
      limitations.push(
        `A página informada (${originLabelMap[classification.origin]}) restringiu leitura direta automatizada (${primaryFetch.error || 'login/bloqueio'}); pesquisa continuada por identificadores e fontes públicas complementares.`
      );
    } else {
      limitations.push(
        `A página informada retornou indisponibilidade (${primaryFetch.error || 'sem resposta'}); pesquisa continuada em outras fontes públicas.`
      );
    }
  }

  const primaryFacts = primaryFetch.ok
    ? extractFromHtml(primaryFetch.html, resolvedUrl)
    : extractFromHtml('', resolvedUrl);

  let primaryName =
    primaryFacts.businessName ||
    classification.mapsPlaceName ||
    classification.mapsQueryHint ||
    classification.slugHint ||
    null;

  let legalName: string | null = primaryFacts.legalName || null;
  let cnpjDigits: string | null = classification.cnpjFromUrl || primaryFacts.cnpjs[0] || null;
  let address: string | null = primaryFacts.address || null;
  let cityState: string | null = primaryFacts.cityState || null;
  let phone: string | null = primaryFacts.phones[0] || null;
  let whatsapp: string | null = primaryFacts.whatsapps[0] || null;
  let email: string | null = primaryFacts.emails[0] || null;
  const hours: string | null = primaryFacts.hours || null;
  let segment: string | null = primaryFacts.segment || null;

  let website: string | null =
    classification.origin === 'website'
      ? `${new URL(resolvedUrl).origin}`
      : primaryFacts.externalWebsites[0] || null;
  let instagram: string | null =
    classification.origin === 'instagram'
      ? resolvedUrl.split('?')[0]
      : primaryFacts.instagrams[0] || null;
  let facebook: string | null =
    classification.origin === 'facebook'
      ? resolvedUrl.split('?')[0]
      : primaryFacts.facebooks[0] || null;
  let linkedin: string | null =
    classification.origin === 'linkedin'
      ? resolvedUrl.split('?')[0]
      : primaryFacts.linkedins[0] || null;
  let googleMapsUrl: string | null =
    classification.origin === 'google_maps'
      ? resolvedUrl
      : primaryFacts.googleMapsUrls[0] || null;

  const fieldStatuses: Record<string, VerificationStatus> = {
    name: primaryName ? (primaryFacts.businessName || classification.mapsPlaceName ? 'confirmed' : 'unconfirmed') : 'not_found',
    legalName: legalName ? 'confirmed' : 'not_found',
    cnpj: cnpjDigits ? 'confirmed' : 'not_found',
    address: address ? 'confirmed' : 'not_found',
    phone: phone ? 'confirmed' : 'not_found',
    whatsapp: whatsapp ? 'confirmed' : 'not_found',
    website: website ? (classification.origin === 'website' && !primaryFetch.ok ? 'unconfirmed' : 'confirmed') : 'not_found',
    instagram: instagram ? 'confirmed' : 'not_found',
    facebook: facebook ? 'confirmed' : 'not_found',
    googleMapsUrl: googleMapsUrl ? 'confirmed' : 'not_found',
    hours: hours ? 'confirmed' : 'not_found',
  };

  // Step 4: If CNPJ already discovered, query BrasilAPI / CNPJ.ws immediately
  if (cnpjDigits) {
    onProgress?.(
      'Consultando base pública de CNPJ',
      `Validando dados oficiais para o CNPJ ${formatCnpj(cnpjDigits)}.`
    );
    const cnpjRecord = await lookupCnpjPublicData(cnpjDigits);
    if (cnpjRecord) {
      addSource(cnpjRecord.sourceTitle, cnpjRecord.sourceUrl, 'cnpj_api');
      legalName = cnpjRecord.legalName;
      fieldStatuses.legalName = 'confirmed';
      fieldStatuses.cnpj = 'confirmed';
      if (cnpjRecord.tradeName) {
        primaryName = cnpjRecord.tradeName;
        fieldStatuses.name = 'confirmed';
      } else if (!primaryName) {
        primaryName = cnpjRecord.legalName;
        fieldStatuses.name = 'confirmed';
      }
      if (cnpjRecord.address) {
        address = cnpjRecord.address;
        fieldStatuses.address = 'confirmed';
      }
      if (cnpjRecord.cityState) cityState = cnpjRecord.cityState;
      if (cnpjRecord.phone && !phone) {
        phone = cnpjRecord.phone;
        fieldStatuses.phone = 'confirmed';
      }
      if (cnpjRecord.email && !email) email = cnpjRecord.email;
      if (cnpjRecord.segment) segment = cnpjRecord.segment;
    } else {
      limitations.push(
        `Consulta automática à base pública para o CNPJ ${formatCnpj(cnpjDigits)} não retornou dados completos.`
      );
    }
  }

  // Step 5: Complementary Public Web Search to enrich missing data & cross-validate
  const searchSubject = primaryName || legalName || classification.slugHint;
  if (searchSubject) {
    onProgress?.(
      'Pesquisando fontes públicas complementares',
      `Cruzando presença digital, site oficial, CNPJ e contatos para "${searchSubject}".`
    );

    const anchor = {
      nameTokens: tokenizeName(searchSubject),
      cnpj: cnpjDigits,
      cityTokens: tokenizeName(cityState),
      domain: classification.origin === 'website' ? classification.domain : null,
      handle: classification.instagramHandle || classification.facebookSlug || classification.linkedinSlug,
    };

    const queries: string[] = [];
    const cityPart = cityState ? ` ${cityState.split('-')[0].trim()}` : '';
    const dashParts = searchSubject.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    const shortQuery =
      dashParts.length > 1 && dashParts[dashParts.length - 1].length <= 20
        ? dashParts[dashParts.length - 1]
        : searchSubject.split(/\s+/).slice(0, 5).join(' ');
    queries.push(`${shortQuery}${cityPart}`);
    if (!cnpjDigits || !instagram || !website) {
      queries.push(`${shortQuery}${cityPart} site oficial instagram cnpj`);
    }

    const searchHitsNested = await Promise.all(queries.map((q) => searchPublicWeb(q)));
    const allHits = searchHitsNested.flat();

    if (allHits.length === 0) {
      limitations.push(
        'Busca web complementar não retornou resultados adicionais acessíveis no momento.'
      );
    }

    const pagesToInspect: Array<{ url: string; status: 'confirmed' | 'unconfirmed' }> = [];
    const seenHitUrls = new Set<string>();

    for (const hit of allHits) {
      if (seenHitUrls.has(hit.url)) continue;
      seenHitUrls.add(hit.url);

      const hitText = `${hit.title} ${hit.snippet}`;
      const hitCnpjMatch = hitText.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)?.[0]?.replace(/\D/g, '') || null;
      const validHitCnpj = hitCnpjMatch && isValidCnpj(hitCnpjMatch) ? hitCnpjMatch : null;

      const matchQuality = evaluateIdentityMatch(anchor, hitText, hit.url, validHitCnpj);
      if (matchQuality === 'rejected') continue;

      const hitLower = hit.url.toLowerCase();
      if (hitLower.includes('instagram.com/') && !hitLower.includes('/p/') && !hitLower.includes('/reel/')) {
        if (!instagram) {
          instagram = hit.url.split('?')[0];
          fieldStatuses.instagram = matchQuality;
        }
        addSource(hit.title || 'Instagram', hit.url, 'social');
      } else if (hitLower.includes('facebook.com/') && !hitLower.includes('sharer')) {
        if (!facebook) {
          facebook = hit.url.split('?')[0];
          fieldStatuses.facebook = matchQuality;
        }
        addSource(hit.title || 'Facebook', hit.url, 'social');
      } else if (hitLower.includes('linkedin.com/company/')) {
        if (!linkedin) {
          linkedin = hit.url.split('?')[0];
        }
        addSource(hit.title || 'LinkedIn', hit.url, 'social');
      } else if (hitLower.includes('google.com/maps') || hitLower.includes('maps.app.goo.gl')) {
        if (!googleMapsUrl) {
          googleMapsUrl = hit.url;
          fieldStatuses.googleMapsUrl = matchQuality;
        }
        addSource(hit.title || 'Google Maps', hit.url, 'google_maps');
      } else {
        const hitHost = new URL(hit.url).hostname.toLowerCase().replace(/^www\./, '');
        if (!isPlatformAggregator(hitHost) && !website) {
          website = `${new URL(hit.url).origin}`;
          fieldStatuses.website = matchQuality;
          addSource(hit.title || hitHost, hit.url, 'official_site');
          pagesToInspect.push({ url: hit.url, status: matchQuality });
        } else {
          addSource(hit.title || hitHost, hit.url, 'web');
          if (pagesToInspect.length < 3 && (hitHost.includes('cnpj') || hitHost.includes('casadosdados') || hitHost.includes('guiamais'))) {
            pagesToInspect.push({ url: hit.url, status: matchQuality });
          }
        }
      }

      if (validHitCnpj && !cnpjDigits) {
        cnpjDigits = validHitCnpj;
        fieldStatuses.cnpj = matchQuality;
      }
    }

    // Fetch up to 2 complementary pages (official website / CNPJ page) to enrich address, phone, WhatsApp, CNPJ
    for (const candidate of pagesToInspect.slice(0, 2)) {
      if (candidate.url === resolvedUrl) continue;
      const subFetch = await safeFetchPublicHtml(candidate.url);
      if (!subFetch.ok || !subFetch.html) continue;

      const subFacts = extractFromHtml(subFetch.html, subFetch.resolvedUrl);
      const subVerification = evaluateIdentityMatch(
        anchor,
        `${subFacts.businessName || ''} ${subFacts.metaDescription || ''} ${subFacts.visibleTextSample.slice(0, 800)}`,
        subFetch.resolvedUrl,
        subFacts.cnpjs[0] || null
      );
      if (subVerification === 'rejected') continue;

      if (!primaryName && subFacts.businessName) {
        primaryName = subFacts.businessName;
        fieldStatuses.name = subVerification;
      }
      if (!legalName && subFacts.legalName) {
        legalName = subFacts.legalName;
        fieldStatuses.legalName = subVerification;
      }
      if (!cnpjDigits && subFacts.cnpjs[0]) {
        cnpjDigits = subFacts.cnpjs[0];
        fieldStatuses.cnpj = subVerification;
      }
      if (!address && subFacts.address) {
        address = subFacts.address;
        fieldStatuses.address = subVerification;
      }
      if (!phone && subFacts.phones[0]) {
        phone = subFacts.phones[0];
        fieldStatuses.phone = subVerification;
      }
      if (!whatsapp && subFacts.whatsapps[0]) {
        whatsapp = subFacts.whatsapps[0];
        fieldStatuses.whatsapp = subVerification;
      }
      if (!instagram && subFacts.instagrams[0]) {
        instagram = subFacts.instagrams[0];
        fieldStatuses.instagram = subVerification;
      }
      if (!facebook && subFacts.facebooks[0]) {
        facebook = subFacts.facebooks[0];
        fieldStatuses.facebook = subVerification;
      }
      if (!googleMapsUrl && subFacts.googleMapsUrls[0]) {
        googleMapsUrl = subFacts.googleMapsUrls[0];
        fieldStatuses.googleMapsUrl = subVerification;
      }
    }

    // If complementary search uncovered a CNPJ we hadn't queried yet, enrich via BrasilAPI!
    if (cnpjDigits && fieldStatuses.legalName === 'not_found') {
      const cnpjRecord = await lookupCnpjPublicData(cnpjDigits);
      if (cnpjRecord) {
        const cnpjMatch = evaluateIdentityMatch(
          anchor,
          `${cnpjRecord.legalName} ${cnpjRecord.tradeName || ''} ${cnpjRecord.cityState || ''}`,
          cnpjRecord.sourceUrl,
          cnpjRecord.cnpj
        );
        if (cnpjMatch !== 'rejected') {
          addSource(cnpjRecord.sourceTitle, cnpjRecord.sourceUrl, 'cnpj_api');
          legalName = cnpjRecord.legalName;
          fieldStatuses.legalName = cnpjMatch;
          fieldStatuses.cnpj = cnpjMatch;
          if (!address && cnpjRecord.address) {
            address = cnpjRecord.address;
            fieldStatuses.address = cnpjMatch;
          }
          if (!cityState && cnpjRecord.cityState) cityState = cnpjRecord.cityState;
          if (!phone && cnpjRecord.phone) {
            phone = cnpjRecord.phone;
            fieldStatuses.phone = cnpjMatch;
          }
          if (!segment && cnpjRecord.segment) segment = cnpjRecord.segment;
        }
      }
    }
  } else {
    limitations.push(
      'Não foi possível extrair um nome comercial ou CNPJ claro da URL informada; confirme manualmente os dados principais.'
    );
  }

  if (!website) fieldStatuses.website = 'not_found';
  if (!instagram) fieldStatuses.instagram = 'not_found';
  if (!facebook) fieldStatuses.facebook = 'not_found';
  if (!googleMapsUrl) fieldStatuses.googleMapsUrl = 'not_found';

  return {
    originalInputUrl: rawInputUrl,
    resolvedMapsUrl: googleMapsUrl || resolvedUrl,
    sourceOrigin: originLabelMap[classification.origin],
    placeName: primaryName,
    legalName,
    cnpj: cnpjDigits ? formatCnpj(cnpjDigits) : null,
    address,
    cityState,
    phone,
    whatsapp,
    email,
    hours,
    segment,
    productsAndServices: primaryFacts.productsAndServices,
    reviewsSummary: null,
    visualReferences: null,
    website,
    instagram,
    facebook,
    linkedin,
    googleMapsUrl,
    queryHint: classification.mapsQueryHint || classification.slugHint,
    latLng: classification.mapsCoords,
    metaTitle: primaryFacts.metaTitle || primaryFacts.title,
    metaDescription: primaryFacts.metaDescription,
    verifiedSources,
    fieldStatuses,
    limitations,
    researchNotes,
    capturedAt: new Date().toISOString(),
  };
}
