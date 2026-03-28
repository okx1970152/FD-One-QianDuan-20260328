import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuthStore, useModelsStore, useNotificationStore } from '@/stores';
import { apiKeysApi } from '@/services/api/apiKeys';
import styles from './VisualConfigEditor.module.scss';
import { copyToClipboard } from '@/utils/clipboard';
import type {
  PayloadFilterRule,
  VisualApiKeyEntry,
  PayloadModelEntry,
  PayloadParamEntry,
  PayloadParamValidationErrorCode,
  PayloadParamValueType,
  PayloadRule,
} from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';
import {
  getPayloadParamValidationError,
  VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS,
  VISUAL_CONFIG_PROTOCOL_OPTIONS,
} from '@/hooks/useVisualConfig';
import { maskApiKey } from '@/utils/format';

/** Minimum character count before the expand/collapse toggle appears. */
const EXPAND_THRESHOLD = 30;

/** Auto-expanding textarea that collapses back to a single-line input on demand. */
function ExpandableInput({
  value,
  placeholder,
  ariaLabel,
  disabled,
  className,
  onChange,
}: {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  onChange: (nextValue: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Strip newlines — these fields are single-line identifiers/paths that
    // would break YAML serialization if they contained line breaks.
    const sanitized = e.target.value.replace(/[\r\n]/g, '');
    onChange(sanitized);
    // autoResize is handled by useLayoutEffect after React syncs the
    // sanitized value back to the DOM — calling it here would measure
    // stale content.
  };

  // Resize synchronously before paint to avoid visual flicker.
  useLayoutEffect(() => {
    if (!collapsed && textareaRef.current) {
      autoResize(textareaRef.current);
    }
  }, [collapsed, value, autoResize]);

  if (collapsed) {
    return (
      <div className={styles.expandableInputWrapper}>
        <input
          className={`input ${className ?? ''}`}
          placeholder={placeholder}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]/g, ''))}
          disabled={disabled}
        />
        {value.length > EXPAND_THRESHOLD && (
          <button
            type="button"
            className={styles.expandableToggle}
            disabled={disabled}
            onClick={() => {
              setCollapsed(false);
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
              });
            }}
            title={t('common.expand')}
            aria-label={t('common.expand')}
          >
            ▼
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.expandableInputWrapper} ${styles.expandableInputExpanded}`}>
      <textarea
        ref={textareaRef}
        className={`input ${styles.expandableTextarea} ${className ?? ''}`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        rows={2}
      />
      <button
        type="button"
        className={styles.expandableToggle}
        disabled={disabled}
        onClick={() => setCollapsed(true)}
        title={t('common.collapse')}
        aria-label={t('common.collapse')}
      >
        ▲
      </button>
    </div>
  );
}

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

function buildProtocolOptions(
  t: ReturnType<typeof useTranslation>['t'],
  rules: Array<{ models: PayloadModelEntry[] }>
) {
  const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    })
  );
  const seen = new Set<string>(options.map((option) => option.value));

  for (const rule of rules) {
    for (const model of rule.models) {
      const protocol = model.protocol;
      if (!protocol || !protocol.trim() || seen.has(protocol)) continue;
      seen.add(protocol);
      options.push({ value: protocol, label: protocol });
    }
  }

  return options;
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor({
  value,
  disabled,
  onChange,
}: {
  value: VisualApiKeyEntry[];
  disabled?: boolean;
  onChange: (nextValue: VisualApiKeyEntry[]) => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const authApiBase = useAuthStore((state) => state.apiBase);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const [liveApiKeys, setLiveApiKeys] = useState<
    Record<
      string,
      {
        expiresAt?: string;
        todayTokens: number;
        totalTokens: number;
        models: Record<string, number>;
      }
    >
  >({});
  const apiKeys = useMemo(
    () =>
      value.map((entry) => ({
        id: entry.id || makeClientId(),
        apiKey: entry.apiKey || '',
        customerName: entry.customerName || '',
        expiresAt: entry.expiresAt || '',
        createdAt: entry.createdAt || '',
        enabled: entry.enabled ?? true,
        note: entry.note || '',
        allowedModels: Array.isArray(entry.allowedModels) ? entry.allowedModels.filter(Boolean) : [],
      })),
    [value]
  );
  const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map((entry) => entry.id || makeClientId()));
  const renderApiKeyIds = useMemo(() => {
    if (apiKeyIds.length === apiKeys.length) return apiKeyIds;
    if (apiKeyIds.length > apiKeys.length) return apiKeyIds.slice(0, apiKeys.length);
    return [
      ...apiKeyIds,
      ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId()),
    ];
  }, [apiKeyIds, apiKeys.length]);

  const apiKeyInputId = useId();
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [expiresAtValue, setExpiresAtValue] = useState('');
  const [note, setNote] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [manualModelInput, setManualModelInput] = useState('');
  const [formError, setFormError] = useState('');

  function generateSecureApiKey(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return 'xxapi-' + Array.from(array, (b) => charset[b % charset.length]).join('');
  }

  function formatDateInput(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function toIsoEndOfDay(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    return `${trimmed}T23:59:59Z`;
  }

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    models.forEach((model) => {
      const name = String(model?.name ?? '').trim();
      if (name) set.add(name);
    });
    apiKeys.forEach((entry) => {
      entry.allowedModels.forEach((model) => {
        const trimmed = model.trim();
        if (trimmed) set.add(trimmed);
      });
    });
    return Array.from(set).sort((left, right) => left.localeCompare(right));
  }, [apiKeys, models]);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, string[]>();
    availableModels.forEach((model) => {
      const group = model.includes('/') ? model.split('/')[0] : 'default';
      const existing = groups.get(group) || [];
      existing.push(model);
      groups.set(group, existing);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [availableModels]);

  const openAddModal = () => {
    setEditingApiKeyId(null);
    setApiKeyValue(generateSecureApiKey());
    setCustomerName('');
    setExpiresInDays('30');
    setExpiresAtValue(formatDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
    setNote('');
    setEnabled(true);
    setAllowedModels([]);
    setManualModelInput('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const current = apiKeys[editingIndex];
    if (!current) return;
    setEditingApiKeyId(apiKeyId);
    setApiKeyValue(current.apiKey);
    setCustomerName(current.customerName);
    setExpiresInDays('');
    setExpiresAtValue(current.expiresAt ? current.expiresAt.slice(0, 10) : '');
    setNote(current.note);
    setEnabled(current.enabled);
    setAllowedModels(current.allowedModels);
    setManualModelInput('');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setApiKeyValue('');
    setCustomerName('');
    setExpiresInDays('30');
    setExpiresAtValue('');
    setNote('');
    setEnabled(true);
    setAllowedModels([]);
    setManualModelInput('');
    setEditingApiKeyId(null);
    setFormError('');
  };

  const updateApiKeys = (nextKeys: VisualApiKeyEntry[]) => {
    onChange(nextKeys);
  };

  const handleDelete = (apiKeyId: string) => {
    const index = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    if (index < 0) return;
    setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId));
    updateApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const trimmed = apiKeyValue.trim();
    if (!trimmed) {
      setFormError('API Key 不能为空');
      return;
    }
    if (!trimmed.startsWith('xxapi-')) {
      setFormError('API Key 必须以 xxapi- 开头');
      return;
    }
    if (allowedModels.length === 0) {
      setFormError('至少选择一个允许调用的模型');
      return;
    }

    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    const nextEntry: VisualApiKeyEntry = {
      id: editingApiKeyId || makeClientId(),
      apiKey: trimmed,
      customerName: customerName.trim(),
      createdAt:
        editingApiKeyId === null
          ? new Date().toISOString()
          : apiKeys[editingIndex]?.createdAt || new Date().toISOString(),
      expiresAt: toIsoEndOfDay(expiresAtValue),
      enabled,
      note: note.trim(),
      allowedModels: Array.from(new Set(allowedModels.map((model) => model.trim()).filter(Boolean))),
    };
    const nextKeys =
      editingApiKeyId === null
        ? [...apiKeys, nextEntry]
        : apiKeys.map((key, idx) => (idx === editingIndex ? nextEntry : key));
    if (editingApiKeyId === null) {
      setApiKeyIds([...renderApiKeyIds, nextEntry.id]);
    }
    updateApiKeys(nextKeys);
    closeModal();
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setApiKeyValue(generateSecureApiKey());
    setFormError('');
  };

  const handleToggleAllowedModel = (modelName: string) => {
    setAllowedModels((current) =>
      current.includes(modelName)
        ? current.filter((item) => item !== modelName)
        : [...current, modelName]
    );
  };

  const handleAddManualModel = () => {
    const trimmed = manualModelInput.trim();
    if (!trimmed) return;
    setAllowedModels((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setManualModelInput('');
  };

  const handleLoadModels = async () => {
    if (!authApiBase) {
      showNotification('当前未连接到服务器，暂时无法自动读取模型列表', 'warning');
      return;
    }
    try {
      await fetchModels(authApiBase, undefined, true);
      showNotification('已刷新可选模型列表', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '读取模型列表失败';
      showNotification(message, 'error');
    }
  };

  const refreshLiveApiKeys = useCallback(async () => {
    if (!authApiBase || connectionStatus !== 'connected') return;
    try {
      const items = await apiKeysApi.list();
      const mapped = Object.fromEntries(
        items.map((item) => [
          item.apiKey,
          {
            expiresAt: item.expiresAt,
            todayTokens: Number(item.usage?.todayTokens ?? 0),
            totalTokens: Number(item.usage?.totalTokens ?? 0),
            models: Object.fromEntries(
              Object.entries(item.usage?.models ?? {}).map(([model, tokens]) => [
                model,
                Number(tokens ?? 0),
              ])
            ),
          },
        ])
      );
      setLiveApiKeys(mapped);
    } catch {
      // Ignore live refresh failures here; the editor still works with local values.
    }
  }, [authApiBase, connectionStatus]);

  useEffect(() => {
    refreshLiveApiKeys();
  }, [refreshLiveApiKeys]);

  const handleExtendKey = async (apiKey: string, days: number) => {
    try {
      await apiKeysApi.extend(apiKey, days);
      showNotification(`已续期 ${days} 天`, 'success');
      await refreshLiveApiKeys();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '续期失败';
      showNotification(message, 'error');
    }
  };

  const baseUrlGuide = useMemo(() => {
    const trimmed = String(authApiBase ?? '').trim().replace(/\/+$/g, '');
    if (!trimmed) return 'http://your-server:8317/v1';
    if (/\/v1$/i.test(trimmed)) return trimmed;
    if (/\/v0\/management$/i.test(trimmed)) {
      return `${trimmed.replace(/\/v0\/management$/i, '')}/v1`;
    }
    return `${trimmed}/v1`;
  }, [authApiBase]);

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div className={styles.blockHeaderRow}>
        <label style={{ margin: 0 }}>
          {t('config_management.visual.api_keys.label', { defaultValue: '商业 API Keys' })}
        </label>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add', { defaultValue: '新增' })}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className={styles.emptyState}>
          {t('config_management.visual.api_keys.empty', { defaultValue: '还没有创建任何 API Key' })}
        </div>
      ) : (
        <div className="item-list" style={{ marginTop: 4 }}>
          {apiKeys.map((entry, index) => (
            <div key={renderApiKeyIds[index] ?? `${entry.apiKey}-${index}`} className="item-row">
              {(() => {
                const live = liveApiKeys[entry.apiKey];
                const expiresAt = live?.expiresAt || entry.expiresAt;
                const todayTokens = live?.todayTokens ?? 0;
                const totalTokens = live?.totalTokens ?? 0;
                const topModels = Object.entries(live?.models ?? {})
                  .sort((left, right) => right[1] - left[1])
                  .slice(0, 3);
                const primaryModel = entry.allowedModels[0] || 'one/gpt-5.4';
                return (
                  <>
                    <div className="item-meta" style={{ display: 'grid', gap: 8 }}>
                      <div className="pill">#{index + 1}</div>
                      <div className="item-title">{entry.customerName || '未命名客户'}</div>
                      <div className="item-subtitle">
                        {maskApiKey(String(entry.apiKey || ''))}
                        {expiresAt ? ` · 到期 ${expiresAt.slice(0, 10)}` : ' · 永不过期'}
                        {entry.enabled ? ' · 启用' : ' · 已禁用'}
                      </div>
                      <div className="item-subtitle">
                        已授权 {entry.allowedModels.length} 个模型
                        {entry.allowedModels.length > 0
                          ? `：${entry.allowedModels.slice(0, 3).join(', ')}`
                          : ''}
                      </div>
                      <div className="item-subtitle">
                        今日 Tokens：{todayTokens} · 总 Tokens：{totalTokens}
                      </div>
                      {topModels.length > 0 ? (
                        <div
                          style={{
                            border: '1px dashed var(--border-color)',
                            borderRadius: 12,
                            padding: 10,
                          }}
                        >
                          <div className="hint" style={{ margin: 0, fontWeight: 600 }}>
                            模型用量 Top
                          </div>
                          {topModels.map(([model, tokens]) => (
                            <div key={model} className="item-subtitle">
                              {model}：{tokens} tokens
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {entry.allowedModels.length > 0 ? (
                        <div className="hint" style={{ margin: 0 }}>
                          模型分布：{entry.allowedModels.join('，')}
                        </div>
                      ) : null}
                      <div
                        style={{
                          border: '1px solid var(--border-color)',
                          borderRadius: 12,
                          padding: 12,
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <div className="hint" style={{ margin: 0, fontWeight: 600 }}>
                          配置指南
                        </div>
                        <div className="item-subtitle">Base URL：{baseUrlGuide}</div>
                        <div className="item-subtitle">API Key：{entry.apiKey}</div>
                        <div className="item-subtitle">示例模型：{primaryModel}</div>
                      </div>
                    </div>
                    <div className="item-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExtendKey(entry.apiKey, 30)}
                        disabled={disabled}
                      >
                        续期 30 天
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExtendKey(entry.apiKey, 60)}
                        disabled={disabled}
                      >
                        续期 60 天
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopy(entry.apiKey)}
                        disabled={disabled}
                      >
                        {t('common.copy')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditModal(renderApiKeyIds[index] ?? '')}
                        disabled={disabled}
                      >
                        {t('config_management.visual.common.edit', { defaultValue: '编辑' })}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(renderApiKeyIds[index] ?? '')}
                        disabled={disabled}
                      >
                        {t('config_management.visual.common.delete', { defaultValue: '删除' })}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      <div className="hint">
        创建时自动生成 `xxapi-` 前缀密钥，并为每个客户绑定允许调用的完整模型名，例如
        `one/gpt-5.4`。
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingApiKeyId !== null
            ? '编辑商业 API Key'
            : '创建商业 API Key'
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              {t('config_management.visual.common.cancel', { defaultValue: '取消' })}
            </Button>
            <Button onClick={handleSave} disabled={disabled}>
              {editingApiKeyId !== null ? '更新' : '创建'}
            </Button>
          </>
        }
      >
        <div className="form-group" style={{ display: 'grid', gap: 12 }}>
          <label htmlFor={apiKeyInputId}>API Key</label>
          <div className={styles.apiKeyModalInputRow}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder="xxapi-xxxxxxxxxxxxxxxx"
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              disabled={disabled}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={disabled}
            >
              重新生成
            </Button>
          </div>
          <div id={apiKeyHintId} className="hint">
            系统默认自动生成，建议不要手动修改。
          </div>
          <label>客户名称</label>
          <input
            className="input"
            placeholder="例如：one"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            disabled={disabled}
          />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div>
              <label>有效期天数</label>
              <Select
                value={expiresInDays}
                onChange={(value) => {
                  setExpiresInDays(value);
                  if (value) {
                    const days = Number(value);
                    if (Number.isFinite(days) && days > 0) {
                      setExpiresAtValue(
                        formatDateInput(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
                      );
                    }
                  }
                }}
                options={[
                  { value: '7', label: '7 天' },
                  { value: '30', label: '30 天' },
                  { value: '60', label: '60 天' },
                  { value: '90', label: '90 天' },
                  { value: '', label: '自定义 / 永不过期' },
                ]}
                disabled={disabled}
              />
            </div>
            <div>
              <label>到期日期</label>
              <input
                className="input"
                type="date"
                value={expiresAtValue}
                onChange={(e) => setExpiresAtValue(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
          <label>备注</label>
          <input
            className="input"
            placeholder="例如：月付套餐 / 企业客户"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={disabled}
            />
            启用此 API Key
          </label>
          <div className={styles.blockHeaderRow}>
            <label style={{ margin: 0 }}>允许调用的模型</label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleLoadModels}
              disabled={disabled || modelsLoading}
            >
              {modelsLoading ? '刷新中...' : '刷新模型列表'}
            </Button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className={styles.apiKeyModalInputRow}>
              <input
                className="input"
                placeholder="手动补充完整模型名，例如 one/gpt-5.4"
                value={manualModelInput}
                onChange={(e) => setManualModelInput(e.target.value)}
                disabled={disabled}
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleAddManualModel} disabled={disabled}>
                添加
              </Button>
            </div>
            {groupedModels.length === 0 ? (
              <div className="hint">当前还没有可供选择的模型列表，可以手动输入完整模型名。</div>
            ) : (
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 12, padding: 12 }}>
                {groupedModels.map(([group, items]) => (
                  <div key={group} style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                    <div className="hint" style={{ margin: 0, fontWeight: 600 }}>
                      {group === 'default' ? '未分组' : group}
                    </div>
                    {items.map((modelName) => (
                      <label key={modelName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={allowedModels.includes(modelName)}
                          onChange={() => handleToggleAllowedModel(modelName)}
                          disabled={disabled}
                        />
                        <span>{modelName}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {allowedModels.length > 0 ? (
              <div className="hint">
                当前已授权：{allowedModels.join(', ')}
              </div>
            ) : null}
          </div>
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
});

const StringListEditor = memo(function StringListEditor({
  value,
  disabled,
  placeholder,
  inputAriaLabel,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const items = value.length ? value : [];
  const [itemIds, setItemIds] = useState(() => items.map(() => makeClientId()));
  const renderItemIds = useMemo(() => {
    if (itemIds.length === items.length) return itemIds;
    if (itemIds.length > items.length) return itemIds.slice(0, items.length);
    return [
      ...itemIds,
      ...Array.from({ length: items.length - itemIds.length }, () => makeClientId()),
    ];
  }, [itemIds, items.length]);

  const updateItem = (index: number, nextValue: string) =>
    onChange(items.map((item, i) => (i === index ? nextValue : item)));
  const addItem = () => {
    setItemIds([...renderItemIds, makeClientId()]);
    onChange([...items, '']);
  };
  const removeItem = (index: number) => {
    setItemIds(renderItemIds.filter((_, i) => i !== index));
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.stringList}>
      {items.map((item, index) => (
        <div key={renderItemIds[index] ?? `item-${index}`} className={styles.stringListRow}>
          <ExpandableInput
            placeholder={placeholder}
            ariaLabel={inputAriaLabel ?? placeholder}
            value={item}
            onChange={(nextValue) => updateItem(index, nextValue)}
            disabled={disabled}
          />
          <Button variant="ghost" size="sm" onClick={() => removeItem(index)} disabled={disabled}>
            {t('config_management.visual.common.delete')}
          </Button>
        </div>
      ))}
      <div className={styles.actionRow}>
        <Button variant="secondary" size="sm" onClick={addItem} disabled={disabled}>
          {t('config_management.visual.common.add')}
        </Button>
      </div>
    </div>
  );
});

export const PayloadRulesEditor = memo(function PayloadRulesEditor({
  value,
  disabled,
  protocolFirst = false,
  rawJsonValues = false,
  onChange,
}: {
  value: PayloadRule[];
  disabled?: boolean;
  protocolFirst?: boolean;
  rawJsonValues?: boolean;
  onChange: (next: PayloadRule[]) => void;
}) {
  const { t } = useTranslation();
  const rules = value;
  const protocolOptions = useMemo(() => buildProtocolOptions(t, rules), [rules, t]);
  const payloadValueTypeOptions = useMemo(
    () =>
      VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      })),
    [t]
  );
  const booleanValueOptions = useMemo(
    () => [
      { value: 'true', label: t('config_management.visual.payload_rules.boolean_true') },
      { value: 'false', label: t('config_management.visual.payload_rules.boolean_false') },
    ],
    [t]
  );

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (
    ruleIndex: number,
    modelIndex: number,
    patch: Partial<PayloadModelEntry>
  ) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  const addParam = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextParam: PayloadParamEntry = {
      id: makeClientId(),
      path: '',
      valueType: rawJsonValues ? 'json' : 'string',
      value: '',
    };
    updateRule(ruleIndex, { params: [...rule.params, nextParam] });
  };

  const removeParam = (ruleIndex: number, paramIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { params: rule.params.filter((_, i) => i !== paramIndex) });
  };

  const updateParam = (
    ruleIndex: number,
    paramIndex: number,
    patch: Partial<PayloadParamEntry>
  ) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      params: rule.params.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)),
    });
  };

  const getValuePlaceholder = (valueType: PayloadParamValueType) => {
    switch (valueType) {
      case 'string':
        return t('config_management.visual.payload_rules.value_string');
      case 'number':
        return t('config_management.visual.payload_rules.value_number');
      case 'boolean':
        return t('config_management.visual.payload_rules.value_boolean');
      case 'json':
        return t('config_management.visual.payload_rules.value_json');
      default:
        return t('config_management.visual.payload_rules.value_default');
    }
  };

  const getParamErrorMessage = (param: PayloadParamEntry) => {
    const errorCode = getPayloadParamValidationError(
      rawJsonValues ? { ...param, valueType: 'json' } : param
    );
    return getValidationMessage(t, errorCode);
  };

  const renderParamValueEditor = (
    ruleIndex: number,
    paramIndex: number,
    param: PayloadParamEntry
  ) => {
    if (rawJsonValues) {
      return (
        <textarea
          className={`input ${styles.payloadJsonInput}`}
          placeholder={t('config_management.visual.payload_rules.value_raw_json')}
          aria-label={t('config_management.visual.payload_rules.param_value')}
          value={param.value}
          onChange={(e) =>
            updateParam(ruleIndex, paramIndex, { value: e.target.value, valueType: 'json' })
          }
          disabled={disabled}
        />
      );
    }

    if (param.valueType === 'boolean') {
      return (
        <Select
          value={
            param.value.toLowerCase() === 'true' || param.value.toLowerCase() === 'false'
              ? param.value.toLowerCase()
              : ''
          }
          options={booleanValueOptions}
          placeholder={t('config_management.visual.payload_rules.value_boolean')}
          disabled={disabled}
          ariaLabel={t('config_management.visual.payload_rules.param_value')}
          onChange={(nextValue) => updateParam(ruleIndex, paramIndex, { value: nextValue })}
        />
      );
    }

    if (param.valueType === 'json') {
      return (
        <textarea
          className={`input ${styles.payloadJsonInput}`}
          placeholder={getValuePlaceholder(param.valueType)}
          aria-label={t('config_management.visual.payload_rules.param_value')}
          value={param.value}
          onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
          disabled={disabled}
        />
      );
    }

    return (
      <ExpandableInput
        placeholder={getValuePlaceholder(param.valueType)}
        ariaLabel={t('config_management.visual.payload_rules.param_value')}
        value={param.value}
        onChange={(nextValue) => updateParam(ruleIndex, paramIndex, { value: nextValue })}
        disabled={disabled}
      />
    );
  };

  return (
    <div className={styles.blockStack}>
      {rules.map((rule, ruleIndex) => (
        <div key={rule.id} className={styles.ruleCard}>
          <div className={styles.ruleCardHeader}>
            <div className={styles.ruleCardTitle}>
              {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeRule(ruleIndex)}
              disabled={disabled}
            >
              {t('config_management.visual.common.delete')}
            </Button>
          </div>

          <div className={styles.blockStack}>
            <div className={styles.blockLabel}>
              {t('config_management.visual.payload_rules.models')}
            </div>
            {(rule.models.length ? rule.models : []).map((model, modelIndex) => (
              <div
                key={model.id}
                className={[
                  styles.payloadRuleModelRow,
                  protocolFirst ? styles.payloadRuleModelRowProtocolFirst : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {protocolFirst ? (
                  <>
                    <Select
                      value={model.protocol ?? ''}
                      options={protocolOptions}
                      disabled={disabled}
                      ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                    <ExpandableInput
                      placeholder={t('config_management.visual.payload_rules.model_name')}
                      ariaLabel={t('config_management.visual.payload_rules.model_name')}
                      value={model.name}
                      onChange={(nextValue) => updateModel(ruleIndex, modelIndex, { name: nextValue })}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <>
                    <ExpandableInput
                      placeholder={t('config_management.visual.payload_rules.model_name')}
                      ariaLabel={t('config_management.visual.payload_rules.model_name')}
                      value={model.name}
                      onChange={(nextValue) => updateModel(ruleIndex, modelIndex, { name: nextValue })}
                      disabled={disabled}
                    />
                    <Select
                      value={model.protocol ?? ''}
                      options={protocolOptions}
                      disabled={disabled}
                      ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.payloadRowActionButton}
                  onClick={() => removeModel(ruleIndex, modelIndex)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            ))}
            <div className={styles.actionRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => addModel(ruleIndex)}
                disabled={disabled}
              >
                {t('config_management.visual.payload_rules.add_model')}
              </Button>
            </div>
          </div>

          <div className={styles.blockStack}>
            <div className={styles.blockLabel}>
              {t('config_management.visual.payload_rules.params')}
            </div>
            {(rule.params.length ? rule.params : []).map((param, paramIndex) => {
              const paramError = getParamErrorMessage(param);

              return (
                <div key={param.id} className={styles.payloadRuleParamGroup}>
                  <div className={styles.payloadRuleParamRow}>
                    <ExpandableInput
                      placeholder={t('config_management.visual.payload_rules.json_path')}
                      ariaLabel={t('config_management.visual.payload_rules.json_path')}
                      value={param.path}
                      onChange={(nextValue) => updateParam(ruleIndex, paramIndex, { path: nextValue })}
                      disabled={disabled}
                    />
                    {rawJsonValues ? null : (
                      <Select
                        value={param.valueType}
                        options={payloadValueTypeOptions}
                        disabled={disabled}
                        ariaLabel={t('config_management.visual.payload_rules.param_type')}
                        onChange={(nextValue) =>
                          updateParam(ruleIndex, paramIndex, {
                            valueType: nextValue as PayloadParamValueType,
                            value:
                              nextValue === 'boolean'
                                ? 'true'
                                : nextValue === 'json' && param.value.trim() === ''
                                  ? '{}'
                                  : param.value,
                          })
                        }
                      />
                    )}
                    {renderParamValueEditor(ruleIndex, paramIndex, param)}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.payloadRowActionButton}
                      onClick={() => removeParam(ruleIndex, paramIndex)}
                      disabled={disabled}
                    >
                      {t('config_management.visual.common.delete')}
                    </Button>
                  </div>
                  {paramError && (
                    <div className={`error-box ${styles.payloadParamError}`}>{paramError}</div>
                  )}
                </div>
              );
            })}
            <div className={styles.actionRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => addParam(ruleIndex)}
                disabled={disabled}
              >
                {t('config_management.visual.payload_rules.add_param')}
              </Button>
            </div>
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <div className={styles.emptyState}>
          {t('config_management.visual.payload_rules.no_rules')}
        </div>
      )}

      <div className={styles.actionRow}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          {t('config_management.visual.payload_rules.add_rule')}
        </Button>
      </div>
    </div>
  );
});

export const PayloadFilterRulesEditor = memo(function PayloadFilterRulesEditor({
  value,
  disabled,
  onChange,
}: {
  value: PayloadFilterRule[];
  disabled?: boolean;
  onChange: (next: PayloadFilterRule[]) => void;
}) {
  const { t } = useTranslation();
  const rules = value;
  const protocolOptions = useMemo(() => buildProtocolOptions(t, rules), [rules, t]);

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadFilterRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (
    ruleIndex: number,
    modelIndex: number,
    patch: Partial<PayloadModelEntry>
  ) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  return (
    <div className={styles.blockStack}>
      {rules.map((rule, ruleIndex) => (
        <div key={rule.id} className={styles.ruleCard}>
          <div className={styles.ruleCardHeader}>
            <div className={styles.ruleCardTitle}>
              {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeRule(ruleIndex)}
              disabled={disabled}
            >
              {t('config_management.visual.common.delete')}
            </Button>
          </div>

          <div className={styles.blockStack}>
            <div className={styles.blockLabel}>
              {t('config_management.visual.payload_rules.models')}
            </div>
            {rule.models.map((model, modelIndex) => (
              <div key={model.id} className={styles.payloadFilterModelRow}>
                <ExpandableInput
                  placeholder={t('config_management.visual.payload_rules.model_name')}
                  ariaLabel={t('config_management.visual.payload_rules.model_name')}
                  value={model.name}
                  onChange={(nextValue) => updateModel(ruleIndex, modelIndex, { name: nextValue })}
                  disabled={disabled}
                />
                <Select
                  value={model.protocol ?? ''}
                  options={protocolOptions}
                  disabled={disabled}
                  ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                  onChange={(nextValue) =>
                    updateModel(ruleIndex, modelIndex, {
                      protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.payloadRowActionButton}
                  onClick={() => removeModel(ruleIndex, modelIndex)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            ))}
            <div className={styles.actionRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => addModel(ruleIndex)}
                disabled={disabled}
              >
                {t('config_management.visual.payload_rules.add_model')}
              </Button>
            </div>
          </div>

          <div className={styles.blockStack}>
            <div className={styles.blockLabel}>
              {t('config_management.visual.payload_rules.remove_params')}
            </div>
            <StringListEditor
              value={rule.params}
              disabled={disabled}
              placeholder={t('config_management.visual.payload_rules.json_path_filter')}
              inputAriaLabel={t('config_management.visual.payload_rules.json_path_filter')}
              onChange={(params) => updateRule(ruleIndex, { params })}
            />
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <div className={styles.emptyState}>
          {t('config_management.visual.payload_rules.no_rules')}
        </div>
      )}

      <div className={styles.actionRow}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          {t('config_management.visual.payload_rules.add_rule')}
        </Button>
      </div>
    </div>
  );
});
