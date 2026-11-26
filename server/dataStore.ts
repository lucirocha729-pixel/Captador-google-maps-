import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CollectedResearchData,
  ScannerBlueprintResult,
} from '../src/types/blueprint.ts';
import type { UploadedMaterialFile } from './inputInterpreter.ts';
import { normalizeHttpUrl } from './universalResearch.ts';

export interface StoredResearchRecord {
  researchId: string;
  inputFingerprint: string;
  companyKey: string;
  collectedData: CollectedResearchData;
  blueprint: ScannerBlueprintResult | null;
  enrichmentMode: 'none' | 'local' | 'gemini_enriched';
  createdAt: string;
  updatedAt: string;
}

const STORE_TTL_MS = 24 * 60 * 60 * 1000; // 24h retention for completed research reuse
const MAX_RECORDS = 100;
const STORE_DIR = path.resolve(process.cwd(), '.vira-data');
const STORE_FILE = path.join(STORE_DIR, 'research-store.json');

const byId = new Map<string, StoredResearchRecord>();
const byFingerprint = new Map<string, string>();
const byCompanyKey = new Map<string, string>();
let loadedFromDisk = false;

function ensureLoaded(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoredResearchRecord[];
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const rec of parsed) {
      if (!rec?.researchId || !rec?.collectedData) continue;
      const age = now - new Date(rec.updatedAt || rec.createdAt || 0).getTime();
      if (Number.isFinite(age) && age > STORE_TTL_MS) continue;
      byId.set(rec.researchId, rec);
      if (rec.inputFingerprint) byFingerprint.set(rec.inputFingerprint, rec.researchId);
      if (rec.companyKey) byCompanyKey.set(rec.companyKey, rec.researchId);
    }
  } catch {
    // Non-fatal: continue with clean in-memory store
  }
}

function persistToDisk(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    const records = Array.from(byId.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_RECORDS);
    const tmpFile = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch {
    // Non-fatal if filesystem is read-only; in-memory store remains intact
  }
}

export function computeInputFingerprint(
  rawText: string,
  files: UploadedMaterialFile[]
): string {
  const hash = crypto.createHash('sha256');
  hash.update(rawText.trim().replace(/\s+/g, ' ').toLowerCase());
  const fileEntries = [...files]
    .map((f) => {
      const fHash = crypto.createHash('sha256').update(f.buffer).digest('hex');
      return `${f.originalname}:${f.size}:${fHash}`;
    })
    .sort();
  for (const entry of fileEntries) {
    hash.update('|');
    hash.update(entry);
  }
  return hash.digest('hex');
}

export function computeCompanyKey(collected: CollectedResearchData, rawInput = ''): string {
  if (collected.cnpj) {
    return `cnpj:${collected.cnpj.replace(/\D/g, '')}`;
  }
  const urlCandidate = normalizeHttpUrl(
    collected.googleMapsUrl ||
      collected.website ||
      collected.instagram ||
      collected.resolvedMapsUrl
  );
  if (urlCandidate) {
    try {
      const u = new URL(urlCandidate);
      return `url:${u.hostname.toLowerCase()}${u.pathname}${u.search}`.replace(/\/+$/, '');
    } catch {
      // fall through
    }
  }
  const nameKey = (collected.placeName || collected.legalName || rawInput)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const cityKey = (collected.cityState || '').toLowerCase().trim();
  return `name:${nameKey}|${cityKey}`;
}

function isFresh(rec: StoredResearchRecord): boolean {
  const age = Date.now() - new Date(rec.updatedAt || rec.createdAt).getTime();
  return Number.isFinite(age) && age <= STORE_TTL_MS;
}

export function getResearchById(researchId: string | null | undefined): StoredResearchRecord | null {
  if (!researchId) return null;
  ensureLoaded();
  const rec = byId.get(researchId);
  if (!rec || !isFresh(rec)) return null;
  return rec;
}

export function findResearchByFingerprint(fingerprint: string): StoredResearchRecord | null {
  ensureLoaded();
  const id = byFingerprint.get(fingerprint);
  if (!id) return null;
  return getResearchById(id);
}

export function findResearchByCompanyKey(companyKey: string): StoredResearchRecord | null {
  ensureLoaded();
  const id = byCompanyKey.get(companyKey);
  if (!id) return null;
  return getResearchById(id);
}

export function saveResearchData(params: {
  inputFingerprint: string;
  collectedData: CollectedResearchData;
  rawInput?: string;
}): StoredResearchRecord {
  ensureLoaded();
  const companyKey = computeCompanyKey(params.collectedData, params.rawInput || '');
  const existingId = byFingerprint.get(params.inputFingerprint);
  const existing = existingId ? byId.get(existingId) : undefined;
  const now = new Date().toISOString();

  const researchId =
    existing?.researchId ||
    `res_${crypto.randomBytes(6).toString('hex')}`;

  const record: StoredResearchRecord = {
    researchId,
    inputFingerprint: params.inputFingerprint,
    companyKey,
    collectedData: params.collectedData,
    blueprint: existing?.blueprint ?? null,
    enrichmentMode: existing?.enrichmentMode ?? 'none',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  byId.set(researchId, record);
  byFingerprint.set(params.inputFingerprint, researchId);
  if (companyKey && !companyKey.endsWith(':|')) {
    byCompanyKey.set(companyKey, researchId);
  }
  persistToDisk();
  return record;
}

export function saveBlueprintForResearch(
  researchId: string,
  blueprint: ScannerBlueprintResult,
  enrichmentMode: 'local' | 'gemini_enriched'
): StoredResearchRecord | null {
  ensureLoaded();
  const rec = byId.get(researchId);
  if (!rec) return null;
  rec.blueprint = blueprint;
  rec.enrichmentMode = enrichmentMode;
  rec.updatedAt = new Date().toISOString();
  byId.set(researchId, rec);
  persistToDisk();
  return rec;
}
