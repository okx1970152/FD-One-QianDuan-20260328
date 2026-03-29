/**
 * 商业 API Key 管理
 */

import { apiClient } from './client';
import type { CommercialApiKeyConfig } from '@/types/config';

type CreateApiKeyPayload = {
  customerName?: string;
  modelPrefix?: string;
  expiresInDays?: number;
  note?: string;
  allowedModels?: string[];
  enabled?: boolean;
};

type UpdateApiKeyPayload = {
  apiKey: string;
  customerName?: string;
  modelPrefix?: string;
  expiresAt?: string;
  note?: string;
  allowedModels?: string[];
  enabled?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeApiKey = (raw: unknown): CommercialApiKeyConfig | null => {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? { apiKey: trimmed, enabled: true, allowedModels: [] } : null;
  }
  if (!isRecord(raw)) return null;

  const apiKeyRaw = raw['api-key'] ?? raw.apiKey ?? raw.key ?? raw.Key;
  const apiKey = String(apiKeyRaw ?? '').trim();
  if (!apiKey) return null;

  const rawAllowedModels = raw['allowed-models'] ?? raw.allowedModels ?? raw['allowed_models'];
  return {
    apiKey,
    customerName: String(raw['customer-name'] ?? raw.customerName ?? '').trim() || undefined,
    modelPrefix: String(raw['model-prefix'] ?? raw.modelPrefix ?? '').trim() || undefined,
    expiresAt: String(raw['expires-at'] ?? raw.expiresAt ?? '').trim() || undefined,
    createdAt: String(raw['created-at'] ?? raw.createdAt ?? '').trim() || undefined,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    note: String(raw.note ?? '').trim() || undefined,
    allowedModels: Array.isArray(rawAllowedModels)
      ? rawAllowedModels.map((value) => String(value ?? '').trim()).filter(Boolean)
      : [],
    usage: isRecord(raw.usage)
      ? {
          todayRequests: Number(raw.usage['today_requests'] ?? raw.usage.todayRequests ?? 0),
          todayTokens: Number(raw.usage['today_tokens'] ?? raw.usage.todayTokens ?? 0),
          totalRequests: Number(raw.usage['total_requests'] ?? raw.usage.totalRequests ?? 0),
          totalTokens: Number(raw.usage['total_tokens'] ?? raw.usage.totalTokens ?? 0),
          models: isRecord(raw.usage.models)
            ? Object.fromEntries(
                Object.entries(raw.usage.models).map(([key, value]) => {
                  if (isRecord(value)) {
                    return [
                      key,
                      {
                        todayTokens: Number(value['today_tokens'] ?? value.todayTokens ?? 0),
                        totalTokens: Number(value['total_tokens'] ?? value.totalTokens ?? 0),
                      },
                    ];
                  }
                  return [
                    key,
                    {
                      todayTokens: 0,
                      totalTokens: Number(value ?? 0),
                    },
                  ];
                })
              )
            : {},
        }
      : undefined,
  };
};

const getWrappedApiKeys = async (path = '/api-keys'): Promise<CommercialApiKeyConfig[]> => {
  const data = await apiClient.get<Record<string, unknown>>(path);
  const keys = data['api-keys'] ?? data.apiKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map(normalizeApiKey).filter(Boolean) as CommercialApiKeyConfig[];
};

export const apiKeysApi = {
  list: () => getWrappedApiKeys('/api-keys'),

  usage: () => getWrappedApiKeys('/api-keys/usage'),

  create: (payload: CreateApiKeyPayload) =>
    apiClient.post('/api-keys', {
      'customer-name': payload.customerName?.trim() || '',
      'model-prefix': payload.modelPrefix?.trim() || '',
      'expires-in-days': payload.expiresInDays ?? 0,
      note: payload.note?.trim() || '',
      'allowed-models': payload.allowedModels ?? [],
      enabled: payload.enabled ?? true,
    }),

  replace: (keys: CommercialApiKeyConfig[]) =>
    apiClient.put(
      '/api-keys',
      keys.map((entry) => ({
        'api-key': entry.apiKey,
        'customer-name': entry.customerName ?? '',
        'model-prefix': entry.modelPrefix ?? '',
        'expires-at': entry.expiresAt ?? '',
        'created-at': entry.createdAt ?? '',
        enabled: entry.enabled ?? true,
        note: entry.note ?? '',
        'allowed-models': entry.allowedModels ?? [],
      }))
    ),

  update: (payload: UpdateApiKeyPayload) =>
    apiClient.patch('/api-keys', {
      'api-key': payload.apiKey,
      'customer-name': payload.customerName,
      'model-prefix': payload.modelPrefix,
      'expires-at': payload.expiresAt,
      note: payload.note,
      'allowed-models': payload.allowedModels,
      enabled: payload.enabled,
    }),

  extend: (apiKey: string, days: number) =>
    apiClient.post('/api-keys/extend', {
      'api-key': apiKey,
      days,
    }),

  delete: (apiKey: string) =>
    apiClient.delete(`/api-keys?api-key=${encodeURIComponent(apiKey)}`),
};
