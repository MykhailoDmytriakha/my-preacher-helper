'use client';

import Link from 'next/link';
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  aiFunctionIds,
  getFunctionCatalog,
  getFunctionDefault,
  isFunctionCatalogTarget,
} from '@/api/clients/ai/functionCatalog';
import LanguageInitializer from '@/components/navigation/LanguageInitializer';
import UsageBar from '@/components/usage/UsageBar';
import { TIER_VALUES, Tier, UserEntitlement } from '@/models/models';
import { auth } from '@/services/firebaseAuth.service';
import { hardCap } from '@/services/usageLimits';
import '@locales/i18n';

import type {
  AiFunctionId,
  FunctionModelTarget,
} from '@/api/clients/ai/functionCatalog';
import type { UsageState } from '@/services/usageLimits';

type AdminAccessState = 'checking' | 'authorized' | 'unauthorized';
type AdminSection = 'users' | 'modelDefaults';
type PromotionMode = 'unchanged' | 'set' | 'clear';
type Role = 'user' | 'admin' | 'superuser';
type UserFilter = 'all' | 'paid' | 'unverified';

type EntitlementPatch = {
  paidTier?: Tier;
  promotion?: { tier: Tier; expiresAt: string } | null;
  usage?: { aiUsed?: number; transcriptionSecondsUsed?: number; audioSecondsUsed?: number };
  role?: Role;
};

type AdminUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  lastSignInTime: string | null;
  lastSeenAt: string | null;
  creationTime: string | null;
  paidTier: Tier;
  effectiveTier: Tier;
  promotion: { tier: Tier; expiresAt: string } | null;
  usage: {
    aiUsed: number;
    transcriptionSecondsUsed: number;
    audioSecondsUsed: number;
    periodStart: string;
  };
  role: Role | null;
  referredBy: string | null;
  referralCount: number;
};

type AdminUsersResponse = {
  users: AdminUser[];
  nextPageToken?: string;
};

type AiModelDefaults = Record<AiFunctionId, FunctionModelTarget>;

type AdminModelDefaultsResponse = {
  stored: Partial<AiModelDefaults>;
  effective: AiModelDefaults;
};

const TIER_TONE: Record<Tier, string> = {
  free: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  tier1: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  tier2: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  tier3: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  tier4: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};

const STATUS_TONE = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  unverified: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  disabled: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
} as const;

// Mirrors the current server usage policy. The admin response intentionally returns only usage,
// so the effective tier is the authoritative client-side source for the display limit.
const AI_USAGE_LIMIT: Record<Tier, number> = {
  free: 100,
  tier1: 500,
  tier2: 1_000,
  tier3: 2_500,
  tier4: 5_000,
};

const AVATAR_TONES = [
  'bg-blue-700',
  'bg-emerald-700',
  'bg-violet-700',
  'bg-amber-700',
  'bg-rose-700',
] as const;

const fieldClassName = 'mt-1 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-950';

const CATALOG_DEFAULTS = Object.fromEntries(aiFunctionIds.map((fn) => {
  const { providerId, modelId } = getFunctionDefault(fn);
  return [fn, { providerId, modelId }];
})) as AiModelDefaults;

const parseResponse = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const errorMessage = (responseBody: unknown, fallback: string): string =>
  responseBody && typeof responseBody === 'object' && 'error' in responseBody
    ? String(responseBody.error)
    : fallback;

const parseNonNegativeNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTier = (value: unknown): value is Tier =>
  typeof value === 'string' && TIER_VALUES.includes(value as Tier);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isRole = (value: unknown): value is Role =>
  value === 'user' || value === 'admin' || value === 'superuser';

const isAdminUser = (value: unknown): value is AdminUser => {
  if (!isRecord(value) || !isRecord(value.usage)) return false;
  const promotionIsValid = value.promotion === null || (
    isRecord(value.promotion)
    && isTier(value.promotion.tier)
    && typeof value.promotion.expiresAt === 'string'
  );

  return typeof value.uid === 'string'
    && isNullableString(value.email)
    && typeof value.emailVerified === 'boolean'
    && typeof value.disabled === 'boolean'
    && isNullableString(value.lastSignInTime)
    && isNullableString(value.lastSeenAt)
    && isNullableString(value.creationTime)
    && isTier(value.paidTier)
    && isTier(value.effectiveTier)
    && promotionIsValid
    && typeof value.usage.aiUsed === 'number'
    && typeof value.usage.transcriptionSecondsUsed === 'number'
    && typeof value.usage.audioSecondsUsed === 'number'
    && typeof value.usage.periodStart === 'string'
    && (value.role === null || isRole(value.role))
    && isNullableString(value.referredBy)
    && typeof value.referralCount === 'number'
    && Number.isInteger(value.referralCount)
    && value.referralCount >= 0;
};

const parseAdminUsersResponse = (value: unknown): AdminUsersResponse | null => {
  if (!isRecord(value) || !Array.isArray(value.users) || !value.users.every(isAdminUser)) return null;
  if (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string') return null;

  return {
    users: value.users,
    ...(typeof value.nextPageToken === 'string' ? { nextPageToken: value.nextPageToken } : {}),
  };
};

const isModelTarget = (fn: AiFunctionId, value: unknown): value is FunctionModelTarget =>
  isRecord(value)
  && typeof value.providerId === 'string'
  && typeof value.modelId === 'string'
  && isFunctionCatalogTarget(fn, {
    providerId: value.providerId as FunctionModelTarget['providerId'],
    modelId: value.modelId,
  });

const parseAdminModelDefaultsResponse = (value: unknown): AdminModelDefaultsResponse | null => {
  if (!isRecord(value) || !isRecord(value.effective) || !isRecord(value.stored)) return null;
  const effective = value.effective;
  const storedValue = value.stored;
  if (!aiFunctionIds.every((fn) => isModelTarget(fn, effective[fn]))) return null;

  const stored: Partial<AiModelDefaults> = {};
  for (const fn of aiFunctionIds) {
    const target = storedValue[fn];
    if (target !== undefined && !isModelTarget(fn, target)) return null;
    if (isModelTarget(fn, target)) stored[fn] = target;
  }

  return { stored, effective: effective as AiModelDefaults };
};

const fetchAdminUsers = async (pageToken?: string): Promise<AdminUsersResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Unauthenticated');

  const token = await currentUser.getIdToken();
  const url = pageToken
    ? `/api/admin/users?${new URLSearchParams({ pageToken }).toString()}`
    : '/api/admin/users';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const responseBody = await parseResponse(response);
  const parsed = parseAdminUsersResponse(responseBody);
  if (!response.ok || !parsed) throw new Error('Could not load users');
  return parsed;
};

const fetchAdminModelDefaults = async (): Promise<AdminModelDefaultsResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Unauthenticated');

  const token = await currentUser.getIdToken();
  const response = await fetch('/api/admin/ai-defaults', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const responseBody = await parseResponse(response);
  const parsed = parseAdminModelDefaultsResponse(responseBody);
  if (!response.ok || !parsed) throw new Error('Could not load model defaults');
  return parsed;
};

const timestampValue = (value: string | null): number => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const mergeUserPages = (current: AdminUser[], incoming: AdminUser[]): AdminUser[] => {
  const usersByUid = new Map(current.map((user) => [user.uid, user]));
  incoming.forEach((user) => usersByUid.set(user.uid, user));
  return [...usersByUid.values()].sort((left, right) =>
    timestampValue(right.lastSignInTime) - timestampValue(left.lastSignInTime));
};

const formatDate = (value: string | null, fallback: string, language?: string): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const formatDateTimeLocal = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const formatRelativeTime = (value: string | null, language: string, fallback: string): string => {
  const timestamp = timestampValue(value);
  if (!timestamp) return fallback;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  if (seconds < 60) return formatter.format(-seconds, 'second');
  if (seconds < 3_600) return formatter.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400) return formatter.format(-Math.round(seconds / 3_600), 'hour');
  return formatter.format(-Math.round(seconds / 86_400), 'day');
};

const resolveLastSeenAt = (user: AdminUser): string | null =>
  user.lastSeenAt ?? user.lastSignInTime;

const resolveEffectiveTierClient = (paidTier: Tier, promotion: AdminUser['promotion']): Tier => {
  if (promotion && new Date(promotion.expiresAt) > new Date()
    && TIER_VALUES.indexOf(promotion.tier) > TIER_VALUES.indexOf(paidTier)) {
    return promotion.tier;
  }
  return paidTier;
};

const getInitials = (email: string | null, uid: string): string => {
  const source = email?.split('@')[0] ?? uid;
  const chunks = source.split(/[._+\-\s]+/).filter(Boolean);
  return (chunks.length > 1 ? chunks.slice(0, 2).map((part) => part[0]).join('') : source.slice(0, 2)).toUpperCase();
};

const avatarTone = (value: string): string => {
  const hash = [...value].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
  return AVATAR_TONES[hash % AVATAR_TONES.length];
};

const truncateUid = (uid: string): string => uid.length <= 13 ? uid : `${uid.slice(0, 6)}…${uid.slice(-5)}`;

const userStatus = (user: AdminUser): keyof typeof STATUS_TONE => {
  if (user.disabled) return 'disabled';
  return user.emailVerified ? 'active' : 'unverified';
};

function Avatar({ user, large = false }: { user: AdminUser; large?: boolean }) {
  return (
    <span className={`${avatarTone(user.email ?? user.uid)} ${large ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs'} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`}>
      {getInitials(user.email, user.uid)}
    </span>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  const { t } = useTranslation();
  return <span className={`${TIER_TONE[tier]} inline-flex rounded-md px-2.5 py-1 text-xs font-bold`}>{t(`admin.users.tiers.${tier}`)}</span>;
}

function StatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  const status = userStatus(user);
  return (
    <span className={`${STATUS_TONE[status]} inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`admin.users.status.${status}`)}
    </span>
  );
}

function UsageMiniBar({ user }: { user: AdminUser }) {
  const baseLimit = AI_USAGE_LIMIT[user.effectiveTier];
  const cap = hardCap(baseLimit, 'discrete');
  const used = user.usage.aiUsed;
  const state: UsageState = used >= cap
    ? 'blocked'
    : used >= baseLimit
      ? 'grace'
      : used >= baseLimit * 0.8
        ? 'warning'
        : 'normal';

  return (
    <UsageBar
      baseLimit={baseLimit}
      hardCap={cap}
      size="compact"
      state={state}
      used={used}
    />
  );
}

function ActivityTime({ value, language, fallback }: { value: string | null; language: string; fallback: string }) {
  return (
    <>
      <p className="font-medium text-slate-600 dark:text-slate-300">{formatRelativeTime(value, language, fallback)}</p>
      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{formatDate(value, '—', language)}</p>
    </>
  );
}

function SkeletonRows() {
  const { t } = useTranslation();
  return (
    <tbody aria-label={t('admin.users.loadingSkeleton')}>
      {[0, 1, 2, 3, 4].map((index) => (
        <tr key={index} className="animate-pulse">
          <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700" /><span className="space-y-1.5"><i className="block h-3 w-36 rounded bg-slate-200 dark:bg-slate-700" /><i className="block h-2.5 w-24 rounded bg-slate-100 dark:bg-slate-800" /></span></div></td>
          {[0, 1, 2, 3, 4].map((cell) => <td className="px-4 py-3" key={cell}><i className="block h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

type UserListProps = {
  users: AdminUser[];
  filteredUsers: AdminUser[];
  filter: UserFilter;
  search: string;
  selectedUid: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  nextPageToken?: string;
  language: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: UserFilter) => void;
  onSelect: (user: AdminUser) => void;
  onLoadMore: () => void;
};

function UserList({ users, filteredUsers, filter, search, selectedUid, loading, loadingMore, error, nextPageToken, language, onSearchChange, onFilterChange, onSelect, onLoadMore }: UserListProps) {
  const { t } = useTranslation();
  const filters: UserFilter[] = ['all', 'paid', 'unverified'];
  const rowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, user: AdminUser) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(user);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="relative min-w-[220px] flex-1">
          <svg aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <label className="sr-only" htmlFor="admin-user-search">{t('admin.users.searchLabel')}</label>
          <input className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-950" id="admin-user-search" onChange={(event) => onSearchChange(event.target.value)} placeholder={t('admin.users.searchPlaceholder')} type="search" value={search} />
        </div>
        <div className="flex gap-1.5" aria-label={t('admin.users.filterLabel')}>
          {filters.map((filterValue) => <button aria-pressed={filter === filterValue} className={filter === filterValue ? 'rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-bold text-white' : 'rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'} key={filterValue} onClick={() => onFilterChange(filterValue)} type="button">{t(`admin.users.filters.${filterValue}`)}</button>)}
        </div>
        <span className="ml-auto whitespace-nowrap text-xs font-semibold text-slate-400 dark:text-slate-500">{t('admin.users.liveCount', { count: filteredUsers.length, loaded: users.length })}</span>
      </div>

      {error && <p className="mx-4 mt-3 text-sm text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[64rem] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800"><tr className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.user')}</th><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.lastLogin')}</th><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.lastSeen')}</th><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.tier')}</th><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.status')}</th><th className="border-b border-slate-200 px-4 py-3 dark:border-slate-700" scope="col">{t('admin.users.columns.usage')}</th></tr></thead>
          {loading ? <SkeletonRows /> : <tbody>{filteredUsers.map((user) => <tr aria-label={t('admin.users.openUser', { email: user.email ?? t('admin.users.noEmail') })} className={`${selectedUid === user.uid ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'} cursor-pointer border-b border-slate-100 text-slate-800 outline-none transition focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:border-slate-800 dark:text-slate-100 dark:focus:bg-blue-950/40`} key={user.uid} onClick={() => onSelect(user)} onKeyDown={(event) => rowKeyDown(event, user)} tabIndex={0}><td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar user={user} /><div className="min-w-0"><p className="truncate font-semibold">{user.email ?? t('admin.users.noEmail')}</p><p className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500" title={user.uid}>{truncateUid(user.uid)}</p></div></div></td><td className="whitespace-nowrap px-4 py-3"><ActivityTime fallback={t('admin.users.neverLoggedIn')} language={language} value={user.lastSignInTime} /></td><td className="whitespace-nowrap px-4 py-3"><ActivityTime fallback={t('admin.users.neverSeen')} language={language} value={resolveLastSeenAt(user)} /></td><td className="px-4 py-3"><TierBadge tier={user.effectiveTier} /></td><td className="px-4 py-3"><StatusBadge user={user} /></td><td className="px-4 py-3"><UsageMiniBar user={user} /></td></tr>)}</tbody>}
        </table>
        {!loading && filteredUsers.length === 0 && <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('admin.users.emptyFiltered')}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.users.emptyFilteredHint')}</p></div>}
      </div>
      {nextPageToken && <button className="m-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700" disabled={loadingMore} onClick={onLoadMore} type="button">{loadingMore ? t('admin.users.loadingMore') : t('admin.users.loadMore')}</button>}
    </section>
  );
}

function KpiStrip({ users }: { users: AdminUser[] }) {
  const { t } = useTranslation();
  const kpis = useMemo(() => {
    const now = Date.now();
    const recent = now - (7 * 24 * 60 * 60 * 1_000);
    return [
      ['total', users.length],
      ['paid', users.filter((user) => user.effectiveTier !== 'free').length],
      ['active7d', users.filter((user) => timestampValue(user.lastSignInTime) >= recent).length],
      ['promoActive', users.filter((user) => user.promotion && timestampValue(user.promotion.expiresAt) > now).length],
    ] as const;
  }, [users]);

  return <section aria-label={t('admin.users.kpisLabel')} className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(([label, value]) => <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900" key={label}><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t(`admin.users.kpi.${label}`)}</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p><p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{t('admin.users.loadedUsers')}</p></div>)}</section>;
}

function AdminNav({ activeSection, onSectionChange }: {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
}) {
  const { t } = useTranslation();
  const sections: AdminSection[] = ['users', 'modelDefaults'];

  return (
    <nav aria-label={t('admin.title')} className="grid grid-cols-2 gap-1 rounded-lg bg-white p-2 shadow dark:bg-slate-800 md:grid-cols-1">
      {sections.map((section) => {
        const active = activeSection === section;
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className={`w-full rounded-lg px-3 py-2.5 text-center text-sm transition-colors md:text-left ${active
              ? 'bg-blue-600 font-semibold text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}
            key={section}
            onClick={() => onSectionChange(section)}
            type="button"
          >
            {t(`admin.modelDefaults.nav.${section}`)}
          </button>
        );
      })}
    </nav>
  );
}

type ModelDefaultsSectionProps = {
  defaults: AiModelDefaults;
  loading: boolean;
  ready: boolean;
  saving: boolean;
  error: string;
  success: boolean;
  onChange: (fn: AiFunctionId, target: FunctionModelTarget) => void;
  onSave: () => void;
};

type ModelFunctionCardProps = {
  fn: AiFunctionId;
  target: FunctionModelTarget;
  disabled: boolean;
  onChange: (fn: AiFunctionId, target: FunctionModelTarget) => void;
};

function ModelFunctionCard({ fn, target, disabled, onChange }: ModelFunctionCardProps) {
  const { t } = useTranslation();
  const catalog = getFunctionCatalog(fn);
  const providers = catalog.filter((entry, index) =>
    catalog.findIndex((candidate) => candidate.providerId === entry.providerId) === index);
  const providerModels = catalog.filter((entry) => entry.providerId === target.providerId);
  const functionTitle = t(`admin.modelDefaults.functions.${fn}`);

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{functionTitle}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)] md:items-end" data-testid={`admin-model-fields-${fn}`}>
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('admin.modelDefaults.provider')}
          <select
            aria-label={`${functionTitle}: ${t('admin.modelDefaults.provider')}`}
            className={fieldClassName}
            disabled={disabled}
            onChange={(event) => {
              const firstModel = catalog.find((entry) => entry.providerId === event.target.value);
              if (firstModel) onChange(fn, { providerId: firstModel.providerId, modelId: firstModel.modelId });
            }}
            value={target.providerId}
          >
            {providers.map((entry) => (
              <option key={entry.providerId} value={entry.providerId}>{entry.providerLabel}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('admin.modelDefaults.model')}
          <select
            aria-label={`${functionTitle}: ${t('admin.modelDefaults.model')}`}
            className={fieldClassName}
            disabled={disabled}
            onChange={(event) => {
              const model = providerModels.find((entry) => entry.modelId === event.target.value);
              if (model) onChange(fn, { providerId: model.providerId, modelId: model.modelId });
            }}
            value={target.modelId}
          >
            {providerModels.map((entry) => (
              <option key={entry.modelId} value={entry.modelId}>{entry.modelId} — {entry.priceLabel}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function ModelDefaultsSection({
  defaults,
  loading,
  ready,
  saving,
  error,
  success,
  onChange,
  onSave,
}: ModelDefaultsSectionProps) {
  const { t } = useTranslation();
  const disabled = !ready || loading || saving;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-labelledby="admin-page-title">
      <div className="flex justify-end">
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400" disabled={disabled} onClick={onSave} type="button">
          {saving ? t('admin.modelDefaults.saving') : t('admin.modelDefaults.save')}
        </button>
      </div>
      <div className="mt-4 space-y-4">
        {aiFunctionIds.map((fn) => (
          <ModelFunctionCard disabled={disabled} fn={fn} key={fn} onChange={onChange} target={defaults[fn]} />
        ))}
      </div>
      {loading && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400" role="status">{t('admin.modelDefaults.loading')}</p>}
      {error && <p className="mt-3 text-sm font-medium text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
      {success && <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">{t('admin.modelDefaults.success')}</p>}
    </section>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">{children}</dd></div>;
}

type DrawerProps = {
  open: boolean;
  user: AdminUser | null;
  targetUid: string;
  paidTier: Tier | '';
  role: Role | '';
  promotionMode: PromotionMode;
  promotionTier: Tier;
  promotionExpiresAt: string;
  aiUsage: string;
  transcriptionSeconds: string;
  audioSeconds: string;
  submitting: boolean;
  submitError: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTargetUidChange: (value: string) => void;
  onPaidTierChange: (value: Tier | '') => void;
  onRoleChange: (value: Role | '') => void;
  onPromotionModeChange: (value: PromotionMode) => void;
  onPromotionTierChange: (value: Tier) => void;
  onPromotionExpiresAtChange: (value: string) => void;
  onAiUsageChange: (value: string) => void;
  onTranscriptionSecondsChange: (value: string) => void;
  onAudioSecondsChange: (value: string) => void;
};

function UserDrawer(props: DrawerProps) {
  const { t, i18n } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(props.onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { open, user } = props;

  useEffect(() => { onCloseRef.current = props.onClose; }, [props.onClose]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  const promotion = user?.promotion ? `${t(`admin.users.tiers.${user.promotion.tier}`)} · ${formatDate(user.promotion.expiresAt, '—', i18n.language)}` : '—';

  return (
    <>
      <button aria-label={t('admin.users.closeDrawer')} className="fixed inset-0 z-40 cursor-default bg-slate-950/35" onClick={props.onClose} type="button" />
      <aside aria-label={t('admin.users.drawerLabel')} aria-modal="true" className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          {user ? <Avatar large user={user} /> : <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-lg text-slate-600 dark:bg-slate-700 dark:text-slate-300">?</span>}
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{user?.email ?? t('admin.users.manualEdit')}</p><p className="mt-0.5 truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{user ? user.uid : t('admin.users.manualUidHint')}</p></div>
          <button aria-label={t('admin.users.closeDrawer')} className="rounded-md p-2 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800 dark:hover:text-white" onClick={props.onClose} ref={closeButtonRef} type="button">×</button>
        </header>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={props.onSubmit}>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {user && <><h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">{t('admin.users.profile')}</h2><dl className="grid grid-cols-2 gap-x-4 gap-y-3"><DetailItem label={t('admin.users.fields.email')}>{user.email ?? t('admin.users.noEmail')}</DetailItem><DetailItem label={t('admin.users.fields.verified')}>{user.emailVerified ? t('admin.users.verified') : t('admin.users.unverified')}</DetailItem><DetailItem label={t('admin.users.fields.disabled')}>{user.disabled ? t('admin.users.disabled') : t('admin.users.enabled')}</DetailItem><DetailItem label={t('admin.users.fields.lastLogin')}><ActivityTime fallback={t('admin.users.neverLoggedIn')} language={i18n.language} value={user.lastSignInTime} /></DetailItem><DetailItem label={t('admin.users.fields.lastSeen')}><ActivityTime fallback={t('admin.users.neverSeen')} language={i18n.language} value={resolveLastSeenAt(user)} /></DetailItem><DetailItem label={t('admin.users.fields.creation')}>{formatDate(user.creationTime, '—', i18n.language)}</DetailItem><DetailItem label={t('admin.users.fields.paidTier')}><TierBadge tier={user.paidTier} /></DetailItem><DetailItem label={t('admin.users.fields.effectiveTier')}><TierBadge tier={user.effectiveTier} /></DetailItem><DetailItem label={t('admin.users.fields.promotion')}>{promotion}</DetailItem><DetailItem label={t('admin.users.fields.referredBy')}>{user.referredBy ?? '—'}</DetailItem><DetailItem label={t('admin.users.fields.invitedCount')}>{user.referralCount}</DetailItem></dl></>}
            <h2 className={`${user ? 'mt-6' : ''} mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500`}>{t('admin.users.editSection')}</h2>
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300" htmlFor="target-uid">{t('admin.targetUid')}<input className={fieldClassName} id="target-uid" onChange={(event) => props.onTargetUidChange(event.target.value)} required value={props.targetUid} /></label>
              <p className="-mt-2 text-xs text-slate-400 dark:text-slate-500">{t('admin.users.manualUidHint')}</p>
              <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold text-slate-600 dark:text-slate-300" htmlFor="paid-tier">{t('admin.paidTier')}<select className={fieldClassName} id="paid-tier" onChange={(event) => props.onPaidTierChange(event.target.value as Tier | '')} value={props.paidTier}><option value="">{t('admin.noChange')}</option>{TIER_VALUES.map((tier) => <option key={tier} value={tier}>{t(`admin.users.tiers.${tier}`)}</option>)}</select></label><label className="text-sm font-semibold text-slate-600 dark:text-slate-300" htmlFor="role">{t('admin.role')}<select className={fieldClassName} id="role" onChange={(event) => props.onRoleChange(event.target.value as Role | '')} value={props.role}><option value="">{t('admin.noChange')}</option>{(['user', 'admin', 'superuser'] as Role[]).map((value) => <option key={value} value={value}>{t(`admin.users.roles.${value}`)}</option>)}</select></label></div>
              <fieldset><legend className="mb-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">{t('admin.promotion')}</legend><div aria-label={t('admin.promotionAction')} className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">{(['unchanged', 'set', 'clear'] as PromotionMode[]).map((mode) => <button aria-pressed={props.promotionMode === mode} className={`${props.promotionMode === mode ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'} flex-1 border-r border-slate-300 px-2 py-2 text-xs font-bold last:border-r-0 dark:border-slate-600`} key={mode} onClick={() => props.onPromotionModeChange(mode)} type="button">{t(`admin.users.promo.${mode}`)}</button>)}</div>{props.promotionMode === 'set' && <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="promotion-tier">{t('admin.promotionTier')}<select className={fieldClassName} id="promotion-tier" onChange={(event) => props.onPromotionTierChange(event.target.value as Tier)} value={props.promotionTier}>{TIER_VALUES.map((tier) => <option key={tier} value={tier}>{t(`admin.users.tiers.${tier}`)}</option>)}</select></label><label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="promotion-expires-at">{t('admin.promotionExpiresAt')}<input className={fieldClassName} id="promotion-expires-at" onChange={(event) => props.onPromotionExpiresAtChange(event.target.value)} type="datetime-local" value={props.promotionExpiresAt} /></label></div>}<p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{t('admin.users.promoHint')}</p></fieldset>
              <fieldset><legend className="mb-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">{t('admin.usage')}</legend><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="ai-usage">{t('admin.aiUsage')}<input className={fieldClassName} id="ai-usage" min="0" onChange={(event) => props.onAiUsageChange(event.target.value)} step="any" type="number" value={props.aiUsage} /></label><label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="transcription-seconds">{t('admin.transcriptionSeconds')}<input className={fieldClassName} id="transcription-seconds" min="0" onChange={(event) => props.onTranscriptionSecondsChange(event.target.value)} step="any" type="number" value={props.transcriptionSeconds} /></label><label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor="audio-seconds">{t('admin.audioSeconds')}<input className={fieldClassName} id="audio-seconds" min="0" onChange={(event) => props.onAudioSecondsChange(event.target.value)} step="any" type="number" value={props.audioSeconds} /></label></div></fieldset>
              {props.submitError && <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">{props.submitError}</p>}
            </div>
          </div>
          <footer className="flex gap-3 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900"><button className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700" onClick={props.onClose} type="button">{t('admin.users.cancel')}</button><button className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400" disabled={props.submitting} type="submit">{props.submitting ? t('admin.submitting') : t('admin.users.save')}</button></footer>
        </form>
      </aside>
    </>
  );
}

export default function AdminPage() {
  const { t, i18n } = useTranslation();
  const [access, setAccess] = useState<AdminAccessState>('checking');
  const [activeSection, setActiveSection] = useState<AdminSection>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [targetUid, setTargetUid] = useState('');
  const [paidTier, setPaidTier] = useState<Tier | ''>('');
  const [promotionMode, setPromotionMode] = useState<PromotionMode>('unchanged');
  const [promotionDirty, setPromotionDirty] = useState(false);
  const [promotionTier, setPromotionTier] = useState<Tier>('free');
  const [promotionExpiresAt, setPromotionExpiresAt] = useState('');
  const [aiUsage, setAiUsage] = useState('');
  const [transcriptionSeconds, setTranscriptionSeconds] = useState('');
  const [audioSeconds, setAudioSeconds] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [modelDefaults, setModelDefaults] = useState<AiModelDefaults>(CATALOG_DEFAULTS);
  const [modelDefaultsLoading, setModelDefaultsLoading] = useState(false);
  const [modelDefaultsReady, setModelDefaultsReady] = useState(false);
  const [modelDefaultsSaving, setModelDefaultsSaving] = useState(false);
  const [modelDefaultsError, setModelDefaultsError] = useState('');
  const [modelDefaultsSaved, setModelDefaultsSaved] = useState(false);
  const selectedUser = useMemo(() => users.find((user) => user.uid === selectedUid) ?? null, [selectedUid, users]);
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return users.filter((user) => {
      const searchMatches = !normalizedSearch || user.uid.toLowerCase().includes(normalizedSearch) || user.email?.toLowerCase().includes(normalizedSearch);
      if (!searchMatches) return false;
      if (filter === 'paid') return user.effectiveTier !== 'free';
      if (filter === 'unverified') return !user.emailVerified;
      return true;
    });
  }, [filter, search, users]);

  useEffect(() => {
    let cancelled = false;
    let adminCheckId = 0;
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      const currentCheckId = ++adminCheckId;
      if (!currentUser) { window.location.href = '/'; return; }
      setAccess('checking');
      if (typeof currentUser.getIdToken !== 'function') { if (!cancelled && currentCheckId === adminCheckId) setAccess('unauthorized'); return; }
      void (async () => {
        try {
          const token = await currentUser.getIdToken();
          const response = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
          const data = await parseResponse(response);
          const isAdmin = response.ok && data !== null && typeof data === 'object' && 'admin' in data && data.admin === true;
          if (!cancelled && currentCheckId === adminCheckId) setAccess(isAdmin ? 'authorized' : 'unauthorized');
        } catch { if (!cancelled && currentCheckId === adminCheckId) setAccess('unauthorized'); }
      })();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (access !== 'authorized') return undefined;
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(false);
    void fetchAdminUsers().then((page) => { if (!cancelled) { setUsers(page.users); setNextPageToken(page.nextPageToken); } }).catch(() => { if (!cancelled) setUsersError(true); }).finally(() => { if (!cancelled) setUsersLoading(false); });
    return () => { cancelled = true; };
  }, [access]);

  useEffect(() => {
    if (access !== 'authorized') return undefined;
    let cancelled = false;
    setModelDefaultsLoading(true);
    setModelDefaultsReady(false);
    setModelDefaultsError('');
    void fetchAdminModelDefaults()
      .then((response) => {
        if (!cancelled) {
          setModelDefaults(response.effective);
          setModelDefaultsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setModelDefaultsError(t('admin.modelDefaults.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setModelDefaultsLoading(false);
      });
    return () => { cancelled = true; };
  }, [access, t]);

  useEffect(() => {
    if (!toastVisible) return undefined;
    const timeout = window.setTimeout(() => setToastVisible(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [toastVisible]);

  const resetEntitlementFields = () => {
    setPaidTier(''); setRole(''); setAiUsage(''); setTranscriptionSeconds(''); setAudioSeconds(''); setPromotionMode('unchanged'); setPromotionDirty(false); setPromotionTier('free'); setPromotionExpiresAt(''); setSubmitError('');
  };

  const selectUser = (user: AdminUser) => {
    setSelectedUid(user.uid); setTargetUid(user.uid); setPaidTier(user.paidTier); setRole(user.role ?? ''); setAiUsage(String(user.usage.aiUsed)); setTranscriptionSeconds(String(user.usage.transcriptionSecondsUsed)); setAudioSeconds(String(user.usage.audioSecondsUsed));
    if (user.promotion) { setPromotionMode('unchanged'); setPromotionTier(user.promotion.tier); setPromotionExpiresAt(formatDateTimeLocal(user.promotion.expiresAt)); } else { setPromotionMode('unchanged'); setPromotionTier('free'); setPromotionExpiresAt(''); }
    setPromotionDirty(false); setSubmitError(''); setDrawerOpen(true);
  };

  const openManualEditor = () => { setSelectedUid(null); setTargetUid(''); resetEntitlementFields(); setDrawerOpen(true); };
  const handleTargetUidChange = (value: string) => {
    setTargetUid(value);
    // Security invariant: a manually changed UID must never retain another user's prefilled privileges.
    if (selectedUid && value.trim() !== selectedUid) { setSelectedUid(null); resetEntitlementFields(); }
  };

  const handleLoadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true); setUsersError(false);
    try { const page = await fetchAdminUsers(nextPageToken); setUsers((current) => mergeUserPages(current, page.users)); setNextPageToken(page.nextPageToken); } catch { setUsersError(true); } finally { setLoadingMore(false); }
  };

  const handleModelDefaultChange = (fn: AiFunctionId, target: FunctionModelTarget) => {
    setModelDefaults((current) => ({ ...current, [fn]: target }));
    setModelDefaultsError('');
    setModelDefaultsSaved(false);
  };

  const handleModelDefaultsSave = async () => {
    if (!modelDefaultsReady) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setModelDefaultsError(t('admin.unauthenticated'));
      return;
    }

    setModelDefaultsSaving(true);
    setModelDefaultsError('');
    setModelDefaultsSaved(false);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/ai-defaults', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modelDefaults),
      });
      const responseBody = await parseResponse(response);
      const parsed = parseAdminModelDefaultsResponse(responseBody);
      if (!response.ok || !parsed) {
        throw new Error(errorMessage(responseBody, t('admin.modelDefaults.saveFailed')));
      }
      setModelDefaults(parsed.effective);
      setModelDefaultsSaved(true);
    } catch (error) {
      setModelDefaultsError(error instanceof Error ? error.message : t('admin.modelDefaults.saveFailed'));
    } finally {
      setModelDefaultsSaving(false);
    }
  };

  const patchSelectedUser = (uid: string, updatedEntitlement: UserEntitlement, patch: EntitlementPatch) => {
    setUsers((currentUsers) => currentUsers.map((user) => {
      if (user.uid !== uid) return user;
      const promotion = updatedEntitlement.promotion ?? null;
      const usage = updatedEntitlement.usage
        ? {
            ...updatedEntitlement.usage,
            audioSecondsUsed: updatedEntitlement.usage.audioSecondsUsed ?? user.usage.audioSecondsUsed,
          }
        : user.usage;
      return { ...user, paidTier: updatedEntitlement.paidTier, promotion, usage, role: patch.role ?? user.role, referredBy: updatedEntitlement.referredBy ?? user.referredBy, effectiveTier: resolveEffectiveTierClient(updatedEntitlement.paidTier, promotion) };
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitError('');
    const uid = targetUid.trim();
    if (!uid) { setSubmitError(t('admin.targetUidRequired')); return; }
    const usage = { aiUsed: parseNonNegativeNumber(aiUsage), transcriptionSecondsUsed: parseNonNegativeNumber(transcriptionSeconds), audioSecondsUsed: parseNonNegativeNumber(audioSeconds) };
    if ((aiUsage.trim() && usage.aiUsed === undefined) || (transcriptionSeconds.trim() && usage.transcriptionSecondsUsed === undefined) || (audioSeconds.trim() && usage.audioSecondsUsed === undefined)) { setSubmitError(t('admin.invalidUsage')); return; }
    const patch: EntitlementPatch = {};
    if (paidTier) patch.paidTier = paidTier;
    // Security invariant: promotion is sent only after an explicit Keep/Set/Clear edit.
    if (promotionDirty && promotionMode === 'clear') patch.promotion = null;
    else if (promotionDirty && promotionMode === 'set') {
      const expiresAt = new Date(promotionExpiresAt);
      if (!promotionExpiresAt || Number.isNaN(expiresAt.getTime())) { setSubmitError(t('admin.invalidPromotion')); return; }
      patch.promotion = { tier: promotionTier, expiresAt: expiresAt.toISOString() };
    }
    if (usage.aiUsed !== undefined || usage.transcriptionSecondsUsed !== undefined || usage.audioSecondsUsed !== undefined) patch.usage = usage;
    if (role) patch.role = role;
    if (Object.keys(patch).length === 0) { setSubmitError(t('admin.noChanges')); return; }
    const currentUser = auth.currentUser;
    if (!currentUser) { setSubmitError(t('admin.unauthenticated')); return; }
    setSubmitting(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/entitlement`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(errorMessage(data, t('admin.requestFailed')));
      patchSelectedUser(uid, data as UserEntitlement, patch);
      setPromotionDirty(false); setToastVisible(true);
    } catch (error) { setSubmitError(error instanceof Error ? error.message : t('admin.requestFailed')); } finally { setSubmitting(false); }
  };

  if (access === 'checking') return <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 text-slate-600 dark:text-slate-300"><p role="status">{t('admin.loading')}</p></main>;
  if (access !== 'authorized') return <main className="mx-auto max-w-3xl px-4 py-10"><section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100"><h1 className="text-xl font-semibold">{t('admin.notAuthorizedTitle')}</h1><p className="mt-2">{t('admin.notAuthorizedDescription')}</p><Link className="mt-4 inline-block font-medium underline" href="/">{t('admin.backHome')}</Link></section></main>;

  const pageTitle = activeSection === 'users'
    ? t('admin.users.pageTitle')
    : t('admin.modelDefaults.title');
  const pageDescription = activeSection === 'users'
    ? t('admin.users.pageDescription')
    : t('admin.modelDefaults.description');

  return <><LanguageInitializer /><main className="mx-auto max-w-screen-2xl px-4 py-7 md:px-5 md:py-8"><div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-8"><aside className="md:sticky md:top-4"><AdminNav activeSection={activeSection} onSectionChange={setActiveSection} /></aside><div className="min-w-0"><header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white" id="admin-page-title">{pageTitle}</h1><p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{pageDescription}</p></div><div className="flex items-center gap-3">{activeSection === 'users' && <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" onClick={openManualEditor} type="button">{t('admin.users.manualEdit')}</button>}<Link className="text-sm font-bold text-blue-700 hover:underline dark:text-blue-300" href="/settings">{t('admin.backToSettings')}</Link></div></header>{activeSection === 'users' ? <><KpiStrip users={users} /><UserList error={usersError ? t('admin.users.loadFailed') : ''} filter={filter} filteredUsers={filteredUsers} language={i18n.language} loading={usersLoading} loadingMore={loadingMore} nextPageToken={nextPageToken} onFilterChange={setFilter} onLoadMore={handleLoadMore} onSearchChange={setSearch} onSelect={selectUser} search={search} selectedUid={selectedUid} users={users} /></> : <ModelDefaultsSection defaults={modelDefaults} error={modelDefaultsError} loading={modelDefaultsLoading} onChange={handleModelDefaultChange} onSave={handleModelDefaultsSave} ready={modelDefaultsReady} saving={modelDefaultsSaving} success={modelDefaultsSaved} />}</div></div></main><UserDrawer aiUsage={aiUsage} audioSeconds={audioSeconds} onAiUsageChange={setAiUsage} onAudioSecondsChange={setAudioSeconds} onClose={() => setDrawerOpen(false)} onPaidTierChange={setPaidTier} onPromotionExpiresAtChange={(value) => { setPromotionExpiresAt(value); setPromotionDirty(true); }} onPromotionModeChange={(value) => { setPromotionMode(value); setPromotionDirty(true); }} onPromotionTierChange={(value) => { setPromotionTier(value); setPromotionDirty(true); }} onRoleChange={setRole} onSubmit={handleSubmit} onTargetUidChange={handleTargetUidChange} onTranscriptionSecondsChange={setTranscriptionSeconds} open={drawerOpen} paidTier={paidTier} promotionExpiresAt={promotionExpiresAt} promotionMode={promotionMode} promotionTier={promotionTier} role={role} submitError={submitError} submitting={submitting} targetUid={targetUid} transcriptionSeconds={transcriptionSeconds} user={selectedUser} />{toastVisible && <div aria-live="polite" className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-xl dark:bg-emerald-600"><span aria-hidden="true">✓</span>{t('admin.users.toastSaved')}</div>}</>;
}
