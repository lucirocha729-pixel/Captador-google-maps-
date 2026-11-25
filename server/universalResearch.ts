import net from 'node:net';
import type {
  CollectedResearchData,
  VerificationStatus,
  VerifiedSource,
} from '../src/types/blueprint.ts';
import {
  interpretBusinessMaterial,
  type InterpretedInput,
} from './inputInterpreter.ts';

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

  // 3. Fallback: minhareceita.org
  const minhaReceita = await tryFetchJson(`https://minhareceita.org/${clean}`);
  if (minhaReceita && typeof minhaReceita.razao_social === 'string') {
    const addrParts = [
      [minhaReceita.descricao_tipo_de_logradouro, minhaReceita.logradouro].filter(Boolean).join(' '),
      minhaReceita.numero,
      minhaReceita.complemento,
      minhaReceita.bairro,
      [minhaReceita.municipio, minhaReceita.uf].filter(Boolean).join('/'),
      minhaReceita.cep ? `CEP ${minhaReceita.cep}` : null,
    ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

    return {
      cnpj: formatCnpj(clean),
      legalName: minhaReceita.razao_social.trim(),
      tradeName:
        typeof minhaReceita.nome_fantasia === 'string' && minhaReceita.nome_fantasia.trim()
          ? minhaReceita.nome_fantasia.trim()
          : null,
      address: addrParts.join(', ') || null,
      cityState:
        minhaReceita.municipio && minhaReceita.uf
          ? `${String(minhaReceita.municipio).trim()} - ${String(minhaReceita.uf).trim()}`
          : null,
      phone:
        typeof minhaReceita.ddd_telefone_1 === 'string' && minhaReceita.ddd_telefone_1.trim()
          ? minhaReceita.ddd_telefone_1.trim()
          : null,
      email: typeof minhaReceita.email === 'string' && minhaReceita.email.trim() ? minhaReceita.email.trim() : null,
      segment:
        typeof minhaReceita.cnae_fiscal_descricao === 'string' && minhaReceita.cnae_fiscal_descricao.trim()
          ? minhaReceita.cnae_fiscal_descricao.trim()
          : null,
      sourceTitle: `Minha Receita (${formatCnpj(clean)})`,
      sourceUrl: `https://minhareceita.org/${clean}`,
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

function last8Digits(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

function evaluateIdentityMatch(
  anchor: {
    nameTokens: string[];
    cnpj: string | null;
    cityTokens: string[];
    phoneLast8: string[];
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

  // Phone tail verification across sources
  const candDigitsOnly = candidateText.replace(/\D/g, '');
  const phoneMatched =
    anchor.phoneLast8.length > 0 &&
    anchor.phoneLast8.some((tail) => tail.length === 8 && candDigitsOnly.includes(tail));

  const candTokens = tokenizeName(candidateText);
  if (anchor.nameTokens.length === 0 || candTokens.length === 0) {
    return phoneMatched ? 'confirmed' : 'unconfirmed';
  }

  const candSet = new Set(candTokens);
  let matched = 0;
  for (const tok of anchor.nameTokens) {
    if (candSet.has(tok)) matched++;
  }
  const overlap = matched / anchor.nameTokens.length;

  const cityMatched =
    anchor.cityTokens.length > 0 && anchor.cityTokens.some((ct) => candSet.has(ct));

  // Protect against homonyms: if candidate explicitly mentions another major Brazilian state/city mismatching anchor
  if (phoneMatched && overlap >= 0.35) {
    return 'confirmed';
  }
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
    'solutudo.com.br',
    'wikipedia.org',
    'wikidata.org',
    'baidu.com',
    'quora.com',
    'reddit.com',
    'tripadvisor.com',
    'tripadvisor.com.br',
    'yelp.com',
    'yelp.com.br',
    'youtube.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'pinterest.com',
    'britannica.com',
    'fandom.com',
    'globo.com',
    'uol.com.br',
    'folha.uol.com.br',
    'estadao.com.br',
  ].some((agg) => lower === agg || lower.endsWith(`.${agg}`));
}

export async function runUniversalCompanyResearchFromMaterial(
  interpreted: InterpretedInput,
  onProgress?: (stage: string, detail: string) => void
): Promise<CollectedResearchData> {
  const limitations: string[] = [...interpreted.limitations];
  const researchNotes: string[] = [...interpreted.interpretationNotes];
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

  // Seed initial state from interpreted multimodal material (marked unconfirmed until cross-validated)
  let primaryName: string | null = interpreted.businessName || null;
  let legalName: string | null = interpreted.legalName || null;
  let cnpjDigits: string | null = interpreted.cnpjs[0] || null;
  let address: string | null = interpreted.addresses[0] || null;
  let cityState: string | null = interpreted.cityStates[0] || null;
  let phone: string | null = interpreted.phones[0] || null;
  let whatsapp: string | null = interpreted.whatsapps[0] || null;
  let email: string | null = interpreted.emails[0] || null;
  let hours: string | null = interpreted.hours || null;
  let segment: string | null = interpreted.segmentHint || null;

  let website: string | null = null;
  let instagram: string | null =
    interpreted.instagramHandles[0]
      ? `https://www.instagram.com/${interpreted.instagramHandles[0]}/`
      : null;
  let facebook: string | null = null;
  let linkedin: string | null = null;
  let googleMapsUrl: string | null = null;
  let primaryDomain: string | null = null;
  let primaryHandle: string | null = interpreted.instagramHandles[0] || null;
  let primaryOriginLabel = interpreted.ocrText
    ? 'Leitura de Imagem (OCR)'
    : interpreted.documentText
      ? 'Documento Empresarial'
      : interpreted.cnpjs.length > 0 && interpreted.urls.length === 0
        ? 'CNPJ Informado'
        : interpreted.urls.length > 0
          ? 'Múltiplas Fontes / Links'
          : 'Identificação Textual';

  let metaTitle: string | null = null;
  let metaDescription: string | null = null;
  let latLng: { latitude: number; longitude: number } | null = null;
  let queryHint: string | null = interpreted.businessName || null;
  const productsAndServices: string[] = [];

  const fieldStatuses: Record<string, VerificationStatus> = {
    name: primaryName ? 'unconfirmed' : 'not_found',
    legalName: legalName ? 'unconfirmed' : 'not_found',
    cnpj: cnpjDigits ? 'unconfirmed' : 'not_found',
    address: address ? 'unconfirmed' : 'not_found',
    phone: phone ? 'unconfirmed' : 'not_found',
    whatsapp: whatsapp ? 'unconfirmed' : 'not_found',
    website: 'not_found',
    instagram: instagram ? 'unconfirmed' : 'not_found',
    facebook: 'not_found',
    googleMapsUrl: 'not_found',
    hours: hours ? 'unconfirmed' : 'not_found',
  };

  // Stage 4a: Inspect extracted URLs (supports 0, 1, or multiple URLs)
  const inspectedPages = new Set<string>();
  if (interpreted.urls.length > 0) {
    onProgress?.(
      'Analisando links detectados no material',
      `Validando ${interpreted.urls.length} endereço(s) público(s) e extraindo metadados.`
    );

    for (let i = 0; i < Math.min(interpreted.urls.length, 3); i++) {
      const candidateUrl = interpreted.urls[i];
      const safeUrl = normalizeHttpUrl(candidateUrl);
      if (!safeUrl) continue;

      let parsedCandidate: URL;
      try {
        parsedCandidate = new URL(safeUrl);
        if (isPrivateOrBlockedHost(parsedCandidate.hostname)) continue;
      } catch {
        continue;
      }

      const fetchRes = await safeFetchPublicHtml(safeUrl);
      const resolvedUrl = fetchRes.resolvedUrl || safeUrl;
      inspectedPages.add(resolvedUrl);

      const classification = classifySourceUrl(resolvedUrl);
      if (i === 0) {
        primaryOriginLabel = originLabelMap[classification.origin];
        if (classification.mapsCoords) latLng = classification.mapsCoords;
        if (classification.mapsQueryHint || classification.slugHint) {
          queryHint = classification.mapsQueryHint || classification.slugHint;
        }
      }

      addSource(
        `${originLabelMap[classification.origin]} (Informado)`,
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

      if (classification.origin === 'website' && !primaryDomain) {
        primaryDomain = classification.domain;
      }
      if ((classification.instagramHandle || classification.facebookSlug || classification.linkedinSlug) && !primaryHandle) {
        primaryHandle = classification.instagramHandle || classification.facebookSlug || classification.linkedinSlug;
      }

      if (classification.origin === 'website' && !website) {
        website = parsedCandidate.origin;
        fieldStatuses.website = fetchRes.ok ? 'confirmed' : 'unconfirmed';
      } else if (classification.origin === 'instagram' && !instagram) {
        instagram = resolvedUrl.split('?')[0];
        fieldStatuses.instagram = 'confirmed';
      } else if (classification.origin === 'facebook' && !facebook) {
        facebook = resolvedUrl.split('?')[0];
        fieldStatuses.facebook = 'confirmed';
      } else if (classification.origin === 'linkedin' && !linkedin) {
        linkedin = resolvedUrl.split('?')[0];
      } else if (classification.origin === 'google_maps' && !googleMapsUrl) {
        googleMapsUrl = resolvedUrl;
        fieldStatuses.googleMapsUrl = 'confirmed';
      }

      if (!fetchRes.ok) {
        if (fetchRes.blocked) {
          limitations.push(
            `A página ${originLabelMap[classification.origin]} (${parsedCandidate.hostname}) restringiu leitura automatizada (${fetchRes.error || 'login/bloqueio'}); continuando pesquisa em fontes complementares.`
          );
        } else {
          limitations.push(
            `A página ${parsedCandidate.hostname} retornou indisponibilidade (${fetchRes.error || 'sem resposta'}); continuando por fontes públicas complementares.`
          );
        }
      }

      const facts = fetchRes.ok ? extractFromHtml(fetchRes.html, resolvedUrl) : extractFromHtml('', resolvedUrl);

      // Guard against mixing unrelated companies if multiple URLs were provided
      if (i > 0 && primaryName) {
        const secondaryCheck = evaluateIdentityMatch(
          {
            nameTokens: tokenizeName(primaryName),
            cnpj: cnpjDigits,
            cityTokens: tokenizeName(cityState),
            phoneLast8: [phone, whatsapp].map(last8Digits).filter(Boolean),
            domain: primaryDomain,
            handle: primaryHandle,
          },
          `${facts.businessName || ''} ${facts.legalName || ''} ${facts.metaDescription || ''}`,
          resolvedUrl,
          classification.cnpjFromUrl || facts.cnpjs[0] || null
        );
        if (secondaryCheck === 'rejected') {
          limitations.push(
            `Um link adicional (${parsedCandidate.hostname}) parece apontar para outra entidade e não foi mesclado para evitar mistura de dados.`
          );
          continue;
        }
      }

      if (facts.metaTitle && !metaTitle) metaTitle = facts.metaTitle;
      if (facts.title && !metaTitle) metaTitle = facts.title;
      if (facts.metaDescription && !metaDescription) metaDescription = facts.metaDescription;

      const nameFromUrl = facts.businessName || classification.mapsPlaceName || classification.mapsQueryHint;
      if (nameFromUrl && (!primaryName || fieldStatuses.name !== 'confirmed')) {
        primaryName = nameFromUrl;
        fieldStatuses.name = facts.businessName || classification.mapsPlaceName ? 'confirmed' : 'unconfirmed';
      } else if (!primaryName && classification.slugHint) {
        primaryName = classification.slugHint;
        fieldStatuses.name = 'unconfirmed';
      }

      if (facts.legalName && !legalName) {
        legalName = facts.legalName;
        fieldStatuses.legalName = 'confirmed';
      }

      const foundCnpj = classification.cnpjFromUrl || facts.cnpjs[0] || null;
      if (foundCnpj && !cnpjDigits) {
        cnpjDigits = foundCnpj;
        fieldStatuses.cnpj = 'confirmed';
      }

      if (facts.address && (!address || fieldStatuses.address !== 'confirmed')) {
        address = facts.address;
        fieldStatuses.address = 'confirmed';
      }
      if (facts.cityState && !cityState) cityState = facts.cityState;
      if (facts.phones[0] && (!phone || fieldStatuses.phone !== 'confirmed')) {
        phone = facts.phones[0];
        fieldStatuses.phone = 'confirmed';
      }
      if (facts.whatsapps[0] && !whatsapp) {
        whatsapp = facts.whatsapps[0];
        fieldStatuses.whatsapp = 'confirmed';
      }
      if (facts.emails[0] && !email) email = facts.emails[0];
      if (facts.hours && !hours) {
        hours = facts.hours;
        fieldStatuses.hours = 'confirmed';
      }
      if (facts.segment && !segment) segment = facts.segment;
      if (facts.instagrams[0] && !instagram) {
        instagram = facts.instagrams[0];
        fieldStatuses.instagram = 'confirmed';
      }
      if (facts.facebooks[0] && !facebook) {
        facebook = facts.facebooks[0];
        fieldStatuses.facebook = 'confirmed';
      }
      if (facts.linkedins[0] && !linkedin) linkedin = facts.linkedins[0];
      if (facts.googleMapsUrls[0] && !googleMapsUrl) {
        googleMapsUrl = facts.googleMapsUrls[0];
        fieldStatuses.googleMapsUrl = 'confirmed';
      }
      if (facts.externalWebsites[0] && !website) {
        website = facts.externalWebsites[0];
        fieldStatuses.website = 'confirmed';
      }
    }
  }

  // Stage 4b: If CNPJ is known, query BrasilAPI / CNPJ.ws / MinhaReceita and check for input contradictions
  if (cnpjDigits) {
    onProgress?.(
      'Consultando bases oficiais de CNPJ',
      `Validando dados cadastrais para CNPJ ${formatCnpj(cnpjDigits)}.`
    );
    const cnpjRecord = await lookupCnpjPublicData(cnpjDigits);
    if (cnpjRecord) {
      addSource(cnpjRecord.sourceTitle, cnpjRecord.sourceUrl, 'cnpj_api');

      // Detect conflict if user typed a company name completely contradictory to the official CNPJ
      if (interpreted.businessName) {
        const userTokens = tokenizeName(interpreted.businessName);
        const officialTokens = new Set([
          ...tokenizeName(cnpjRecord.legalName),
          ...tokenizeName(cnpjRecord.tradeName),
        ]);
        const overlapCount = userTokens.filter((t) => officialTokens.has(t)).length;
        if (userTokens.length >= 2 && overlapCount === 0) {
          limitations.push(
            `Divergência detectada no material enviado: o nome informado ("${interpreted.businessName}") não coincide com o titular oficial do CNPJ ${cnpjRecord.cnpj} ("${cnpjRecord.tradeName || cnpjRecord.legalName}"). Priorizando o registro oficial para evitar mistura de empresas.`
          );
          // Reject conflicting user-entered contact hints so we don't blend two businesses
          if (interpreted.addresses[0] && address === interpreted.addresses[0]) address = null;
          if (interpreted.phones[0] && phone === interpreted.phones[0]) phone = null;
        }
      }

      legalName = cnpjRecord.legalName;
      fieldStatuses.legalName = 'confirmed';
      fieldStatuses.cnpj = 'confirmed';

      if (cnpjRecord.tradeName) {
        primaryName = cnpjRecord.tradeName;
        fieldStatuses.name = 'confirmed';
      } else if (!primaryName || fieldStatuses.name !== 'confirmed') {
        primaryName = cnpjRecord.legalName;
        fieldStatuses.name = 'confirmed';
      }

      if (cnpjRecord.address) {
        address = cnpjRecord.address;
        fieldStatuses.address = 'confirmed';
      }
      if (cnpjRecord.cityState) cityState = cnpjRecord.cityState;
      if (cnpjRecord.phone && (!phone || fieldStatuses.phone !== 'confirmed')) {
        phone = cnpjRecord.phone;
        fieldStatuses.phone = 'confirmed';
      }
      if (cnpjRecord.email && !email) email = cnpjRecord.email;
      if (cnpjRecord.segment) segment = cnpjRecord.segment;
    } else {
      limitations.push(
        `Consulta automática às bases públicas para o CNPJ ${formatCnpj(cnpjDigits)} não retornou dados cadastrais completos no momento.`
      );
    }
  }

  // Stage 5: Complementary Multi-Source Web Search (works with 0 URLs, CNPJ-only, name-only, phone, handle, etc.)
  const searchSubject =
    primaryName ||
    legalName ||
    primaryHandle ||
    interpreted.addresses[0] ||
    interpreted.phones[0] ||
    (cnpjDigits ? formatCnpj(cnpjDigits) : null);
  if (searchSubject) {
    onProgress?.(
      'Pesquisando e cruzando fontes públicas na web',
      `Buscando presença digital, site oficial, CNPJ e contatos para "${searchSubject}".`
    );

    const anchor = {
      nameTokens: tokenizeName(primaryName || legalName || ''),
      cnpj: cnpjDigits,
      cityTokens: tokenizeName(cityState),
      phoneLast8: [phone, whatsapp, ...interpreted.phones].map(last8Digits).filter(Boolean),
      domain: primaryDomain,
      handle: primaryHandle,
    };

    const queries: string[] = [];
    const cityPart = cityState ? ` ${cityState.split(/[-/]/)[0].trim()}` : '';
    if (primaryName || legalName) {
      const baseName = (primaryName || legalName || '').trim();
      const dashParts = baseName.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
      const shortQuery =
        dashParts.length > 1 && dashParts[dashParts.length - 1].length <= 24
          ? dashParts[dashParts.length - 1]
          : baseName.split(/\s+/).slice(0, 6).join(' ');
      queries.push(`${shortQuery}${cityPart}`);
      if (!website || !instagram || !cnpjDigits) {
        queries.push(`${shortQuery}${cityPart} site oficial instagram cnpj`);
      }
    } else if (cnpjDigits) {
      queries.push(`"${formatCnpj(cnpjDigits)}"`);
    } else if (primaryHandle) {
      queries.push(`"${primaryHandle}" instagram empresa`);
    } else if (interpreted.phones[0]) {
      queries.push(`"${interpreted.phones[0]}"`);
    }

    const searchHitsNested = await Promise.all(queries.slice(0, 2).map((q) => searchPublicWeb(q)));
    const allHits = searchHitsNested.flat();

    if (allHits.length === 0) {
      limitations.push(
        'Busca web complementar não retornou resultados públicos indexados no momento.'
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

      // Cross-confirm name/phone/address if a hit matches strongly
      if (matchQuality === 'confirmed' && primaryName && fieldStatuses.name === 'unconfirmed') {
        fieldStatuses.name = 'confirmed';
      }
      if (phone && hitText.replace(/\D/g, '').includes(last8Digits(phone))) {
        fieldStatuses.phone = 'confirmed';
      }

      const hitLower = hit.url.toLowerCase();
      if (hitLower.includes('instagram.com/') && !hitLower.includes('/p/') && !hitLower.includes('/reel/')) {
        if (!instagram || fieldStatuses.instagram !== 'confirmed') {
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
        if (!linkedin) linkedin = hit.url.split('?')[0];
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
          if (
            pagesToInspect.length < 3 &&
            (hitHost.includes('cnpj') || hitHost.includes('casadosdados') || hitHost.includes('guiamais'))
          ) {
            pagesToInspect.push({ url: hit.url, status: matchQuality });
          }
        }
      }

      if (validHitCnpj && !cnpjDigits) {
        cnpjDigits = validHitCnpj;
        fieldStatuses.cnpj = matchQuality;
      }
    }

    // Fetch up to 2 complementary pages (official website / directory) to enrich & confirm address, phone, WhatsApp, CNPJ
    for (const candidate of pagesToInspect.slice(0, 2)) {
      if (inspectedPages.has(candidate.url)) continue;
      const subFetch = await safeFetchPublicHtml(candidate.url);
      if (!subFetch.ok || !subFetch.html) continue;
      inspectedPages.add(subFetch.resolvedUrl);

      const subFacts = extractFromHtml(subFetch.html, subFetch.resolvedUrl);
      const subVerification = evaluateIdentityMatch(
        anchor,
        `${subFacts.businessName || ''} ${subFacts.metaDescription || ''} ${subFacts.visibleTextSample.slice(0, 900)}`,
        subFetch.resolvedUrl,
        subFacts.cnpjs[0] || null
      );
      if (subVerification === 'rejected') continue;

      if (subFacts.businessName && (!primaryName || fieldStatuses.name !== 'confirmed')) {
        primaryName = subFacts.businessName;
        fieldStatuses.name = subVerification;
      }
      if (subFacts.legalName && !legalName) {
        legalName = subFacts.legalName;
        fieldStatuses.legalName = subVerification;
      }
      if (subFacts.cnpjs[0] && !cnpjDigits) {
        cnpjDigits = subFacts.cnpjs[0];
        fieldStatuses.cnpj = subVerification;
      }
      if (subFacts.address && (!address || fieldStatuses.address !== 'confirmed')) {
        address = subFacts.address;
        fieldStatuses.address = subVerification;
      }
      if (subFacts.cityState && !cityState) cityState = subFacts.cityState;
      if (subFacts.phones[0] && (!phone || fieldStatuses.phone !== 'confirmed')) {
        phone = subFacts.phones[0];
        fieldStatuses.phone = subVerification;
      }
      if (subFacts.whatsapps[0] && !whatsapp) {
        whatsapp = subFacts.whatsapps[0];
        fieldStatuses.whatsapp = subVerification;
      }
      if (subFacts.hours && !hours) {
        hours = subFacts.hours;
        fieldStatuses.hours = subVerification;
      }
      if (subFacts.instagrams[0] && (!instagram || fieldStatuses.instagram !== 'confirmed')) {
        instagram = subFacts.instagrams[0];
        fieldStatuses.instagram = subVerification;
      }
      if (subFacts.facebooks[0] && !facebook) {
        facebook = subFacts.facebooks[0];
        fieldStatuses.facebook = subVerification;
      }
      if (subFacts.googleMapsUrls[0] && !googleMapsUrl) {
        googleMapsUrl = subFacts.googleMapsUrls[0];
        fieldStatuses.googleMapsUrl = subVerification;
      }
      if (subFacts.metaDescription && !metaDescription) {
        metaDescription = subFacts.metaDescription;
      }
    }

    // If complementary search uncovered a CNPJ we hadn't queried yet, enrich via BrasilAPI / CNPJ.ws / MinhaReceita
    if (cnpjDigits && fieldStatuses.legalName !== 'confirmed') {
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
      'O material enviado não apresentou nome comercial, CNPJ ou link suficiente para busca externa; confirme os dados manualmente.'
    );
  }

  // Final status consistency pass
  if (!primaryName) fieldStatuses.name = 'not_found';
  if (!legalName) fieldStatuses.legalName = 'not_found';
  if (!cnpjDigits) fieldStatuses.cnpj = 'not_found';
  if (!address) fieldStatuses.address = 'not_found';
  if (!phone) fieldStatuses.phone = 'not_found';
  if (!whatsapp) fieldStatuses.whatsapp = 'not_found';
  if (!hours) fieldStatuses.hours = 'not_found';
  if (!website) fieldStatuses.website = 'not_found';
  if (!instagram) fieldStatuses.instagram = 'not_found';
  if (!facebook) fieldStatuses.facebook = 'not_found';
  if (!googleMapsUrl) fieldStatuses.googleMapsUrl = 'not_found';

  if (verifiedSources.length === 0) {
    limitations.push(
      'Nenhuma fonte pública externa confirmou esta empresa; os dados exibidos refletem apenas o material enviado e foram marcados como não confirmados ou não encontrados.'
    );
  }

  const bestVerifiedUrl =
    normalizeHttpUrl(googleMapsUrl) ||
    normalizeHttpUrl(website) ||
    normalizeHttpUrl(instagram) ||
    normalizeHttpUrl(interpreted.urls[0]) ||
    '';

  const referenceLabel =
    normalizeHttpUrl(interpreted.urls[0]) ||
    primaryName ||
    (cnpjDigits ? formatCnpj(cnpjDigits) : null) ||
    interpreted.sourceSummary;

  return {
    originalInputUrl: referenceLabel,
    resolvedMapsUrl: normalizeHttpUrl(googleMapsUrl) || bestVerifiedUrl,
    sourceOrigin: primaryOriginLabel,
    inputSummary: interpreted.sourceSummary,
    ocrText: interpreted.ocrText,
    extractedUrls: interpreted.urls,
    maskedCpf: interpreted.maskedCpf,
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
    productsAndServices,
    reviewsSummary: null,
    visualReferences: null,
    website,
    instagram,
    facebook,
    linkedin,
    googleMapsUrl: normalizeHttpUrl(googleMapsUrl),
    queryHint,
    latLng,
    metaTitle,
    metaDescription,
    verifiedSources,
    fieldStatuses,
    limitations: Array.from(new Set(limitations)),
    researchNotes: Array.from(new Set(researchNotes)),
    capturedAt: new Date().toISOString(),
  };
}

export async function runUniversalCompanyResearch(
  rawInputUrl: string,
  onProgress?: (stage: string, detail: string) => void
): Promise<CollectedResearchData> {
  const interpreted = interpretBusinessMaterial({
    rawText: rawInputUrl,
    ocrText: null,
    documentText: null,
  });
  return runUniversalCompanyResearchFromMaterial(interpreted, onProgress);
}
