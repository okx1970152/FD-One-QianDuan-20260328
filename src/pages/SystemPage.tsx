import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconGithub, IconBookOpen, IconExternalLink, IconCode } from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { apiKeysApi } from '@/services/api/apiKeys';
import {
  serverMigrationApi,
  type ServerMigrationImportPreview,
  type ServerMigrationStatus,
} from '@/services/api/serverMigration';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';
import { downloadBlob } from '@/utils/download';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  glm: iconGlm,
  grok: iconGrok,
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<ServerMigrationStatus | null>(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [domainDraft, setDomainDraft] = useState('');
  const [dnsChecking, setDnsChecking] = useState(false);
  const [certIssuing, setCertIssuing] = useState(false);
  const [certProvider, setCertProvider] = useState('certbot');
  const [packageImporting, setPackageImporting] = useState(false);
  const [packagePreviewing, setPackagePreviewing] = useState(false);
  const [certImporting, setCertImporting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [installingIssuer, setInstallingIssuer] = useState<string | null>(null);
  const [lastImportPreview, setLastImportPreview] = useState<ServerMigrationImportPreview | null>(null);
  const [lastBackupPath, setLastBackupPath] = useState('');
  const migrationPackageInputRef = useRef<HTMLInputElement | null>(null);
  const certFileInputRef = useRef<HTMLInputElement | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);

  const apiKeysCache = useRef<string[]>([]);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '鍏朵粬' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;
  const canEditRequestLog = auth.connectionStatus === 'connected' && Boolean(config);
  const dnsStatus = migrationStatus?.dns_status ?? 'unknown';
  const dnsReady = dnsStatus === 'valid';
  const hasDomain = Boolean((migrationStatus?.domain ?? domainDraft).trim());
  const installerStates = migrationStatus?.installers ?? {};
  const selectedIssuerInstalled = Boolean(installerStates[certProvider]?.installed);

  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = auth.serverVersion || t('system_info.version_unknown');
  const buildTime = auth.serverBuildDate
    ? new Date(auth.serverBuildDate).toLocaleString(i18n.language)
    : t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      const text = `${t('system_info.models_error')}${suffix}`;
      setModelStatus({ type: 'error', message: text });
    }
  };

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
      message: t('system_info.clear_login_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () => {
        auth.logout();
        if (typeof localStorage === 'undefined') return;
        const keysToRemove = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);
  }, [requestLogEnabled]);

  const handleInfoVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleVersionCheck = useCallback(async () => {
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      const comparison = compareVersions(latest, auth.serverVersion);

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  }, [auth.serverVersion, showNotification, t]);

  const loadMigrationStatus = useCallback(async () => {
    if (auth.connectionStatus !== 'connected') return;
    setMigrationLoading(true);
    try {
      const data = await serverMigrationApi.getStatus();
      setMigrationStatus(data);
      setDomainDraft(data.domain ?? '');
      if (Array.isArray(data.available_issuers) && data.available_issuers.length > 0) {
        setCertProvider((current) =>
          data.available_issuers?.includes(current) ? current : data.available_issuers?.[0] || current
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`迁移状态加载失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setMigrationLoading(false);
    }
  }, [auth.connectionStatus, showNotification]);

  const handleSaveDomain = useCallback(async () => {
    try {
      await serverMigrationApi.saveDomain(domainDraft.trim());
      showNotification('域名已保存', 'success');
      await loadMigrationStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`淇濆瓨鍩熷悕澶辫触${message ? `: ${message}` : ''}`, 'error');
    }
  }, [domainDraft, loadMigrationStatus, showNotification]);

  const handleCheckDns = useCallback(async () => {
    setDnsChecking(true);
    try {
      const result = await serverMigrationApi.checkDns();
      showNotification(result.message || 'DNS 检测完成', result.status === 'valid' ? 'success' : 'warning');
      await loadMigrationStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`DNS 检测失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setDnsChecking(false);
    }
  }, [loadMigrationStatus, showNotification]);

  const handleIssueCertificate = useCallback(async () => {
    setCertIssuing(true);
    try {
      const result = await serverMigrationApi.issueCertificate(certProvider);
      const message =
        typeof result === 'object' && result && 'message' in result && typeof result.message === 'string'
          ? result.message
          : '证书申请完成';
      showNotification(message, 'success');
      await loadMigrationStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`证书申请失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setCertIssuing(false);
    }
  }, [certProvider, loadMigrationStatus, showNotification]);

  const handleInstallIssuer = useCallback(
    async (provider: string) => {
      setInstallingIssuer(provider);
      try {
        const result = await serverMigrationApi.installIssuer(provider);
        const message =
          typeof result === 'object' && result && 'message' in result && typeof result.message === 'string'
            ? result.message
            : `${provider} installed`;
        showNotification(message, 'success');
        await loadMigrationStatus();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        showNotification(`安装 ${provider} 失败${message ? `: ${message}` : ''}`, 'error');
      } finally {
        setInstallingIssuer(null);
      }
    },
    [loadMigrationStatus, showNotification]
  );

  const handleExportPackage = useCallback(async () => {
    try {
      const response = await serverMigrationApi.exportPackage();
      const blob = response.data as Blob;
      const header = response.headers?.['content-disposition'] ?? response.headers?.['Content-Disposition'];
      const match = typeof header === 'string' ? /filename=\"?([^\";]+)\"?/i.exec(header) : null;
      downloadBlob({
        filename: match?.[1] || `migration-package-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        blob,
      });
      showNotification('迁移包已开始下载', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`导出迁移包失败${message ? `: ${message}` : ''}`, 'error');
    }
  }, [showNotification]);

  const handleImportPackage = useCallback(async (file: File) => {
    setPackageImporting(true);
    try {
      const result = await serverMigrationApi.importPackage(file);
      setLastBackupPath(result.backup_path || '');
      showNotification(result.message || '迁移包导入完成', 'success');
      await loadMigrationStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`导入迁移包失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setPackageImporting(false);
    }
  }, [loadMigrationStatus, showNotification]);

  const handlePreviewAndImportPackage = useCallback(
    async (file: File) => {
      setPackagePreviewing(true);
      try {
        const preview = await serverMigrationApi.previewImportPackage(file);
        setLastImportPreview(preview);
        const summary = [
          `文件数：${preview.files.length}`,
          preview.overwrite_paths?.length ? `将覆盖：${preview.overwrite_paths.length} 项` : '不会覆盖现有文件',
          preview.missing_files?.length ? `缺少关键文件：${preview.missing_files.join(', ')}` : '证书关键文件完整',
          preview.warnings?.length ? `提示：${preview.warnings.join('；')}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        showConfirmation({
          title: '导入迁移包',
          message: `${summary}\n\n确认后将先自动备份当前环境，再执行导入。`,
          confirmText: '确认导入',
          onConfirm: () => {
            void handleImportPackage(file);
          },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        showNotification(`预检查迁移包失败${message ? `: ${message}` : ''}`, 'error');
      } finally {
        setPackagePreviewing(false);
      }
    },
    [handleImportPackage, showConfirmation, showNotification]
  );

  const handleImportCertificate = useCallback(async () => {
    const certFile = certFileInputRef.current?.files?.[0];
    const keyFile = keyFileInputRef.current?.files?.[0];
    if (!certFile || !keyFile) {
      showNotification('请同时选择 fullchain.pem 和 privkey.pem', 'warning');
      return;
    }
    setCertImporting(true);
    try {
      await serverMigrationApi.importCertificate(certFile, keyFile, 'imported');
      showNotification('证书已导入', 'success');
      await loadMigrationStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`导入证书失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setCertImporting(false);
    }
  }, [loadMigrationStatus, showNotification]);

  const handleRestartService = useCallback(async () => {
    setRestarting(true);
    try {
      await serverMigrationApi.restartService();
      showNotification('服务已触发重启', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(`重启服务失败${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setRestarting(false);
    }
  }, [showNotification]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  useEffect(() => {
    void loadMigrationStatus();
  }, [loadMigrationStatus]);

  const dnsBadgeClass =
    dnsStatus === 'valid'
      ? 'success'
      : dnsStatus === 'invalid'
        ? 'error'
        : dnsStatus === 'empty'
          ? 'muted'
          : 'warning';

  const dnsBadgeText =
    dnsStatus === 'valid' ? '已生效' : dnsStatus === 'invalid' ? '未生效' : dnsStatus === 'empty' ? '无域名' : '待检测';

  const certBadgeClass =
    migrationStatus?.certificate.status === 'issued'
      ? 'success'
      : migrationStatus?.certificate.status === 'failed'
        ? 'error'
        : 'muted';

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('system_info.title')}</h1>
      <div className={styles.content}>
        <Card className={styles.aboutCard}>
          <div className={styles.aboutHeader}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.aboutLogo} />
            <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
          </div>

          <div className={styles.aboutInfoGrid}>
            <button
              type="button"
              className={`${styles.infoTile} ${styles.tapTile}`}
              onClick={handleInfoVersionTap}
            >
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.version')}</div>
              </div>
              <div className={styles.tileValue}>{appVersion}</div>
            </button>

            <div className={styles.infoTile}>
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.api_version')}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.tileAction}
                  onClick={() => void handleVersionCheck()}
                  loading={checkingVersion}
                  title={t('system_info.version_check_button')}
                  aria-label={t('system_info.version_check_button')}
                >
                  {t('system_info.version_check_button')}
                </Button>
              </div>
              <div className={styles.tileValue}>{apiVersion}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('footer.build_date')}</div>
              <div className={styles.tileValue}>{buildTime}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('connection.status')}</div>
              <div className={styles.tileValue}>{t(`common.${auth.connectionStatus}_status`)}</div>
              <div className={styles.tileSub}>{auth.apiBase || '-'}</div>
            </div>
          </div>
        </Card>

        <Card title={t('system_info.quick_links_title')}>
          <p className={styles.sectionDescription}>{t('system_info.quick_links_desc')}</p>
          <div className={styles.quickLinks}>
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconGithub size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_main_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_main_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconCode size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_webui_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_webui_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://help.router-for.me/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.docs}`}>
                <IconBookOpen size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_docs')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_docs_desc')}</div>
              </div>
            </a>
          </div>
        </Card>

        <Card
          title={t('system_info.models_title')}
          extra={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchModels({ forceRefresh: true })}
              loading={modelsLoading}
            >
              {t('common.refresh')}
            </Button>
          }
        >
          <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
          {modelStatus && (
            <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>
          )}
          {modelsError && <div className="error-box">{modelsError}</div>}
          {modelsLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : models.length === 0 ? (
            <div className="hint">{t('system_info.models_empty')}</div>
          ) : (
            <div className="item-list">
              {groupedModels.map((group) => {
                const iconSrc = getIconForCategory(group.id);
                return (
                  <div key={group.id} className="item-row">
                    <div className="item-meta">
                      <div className={styles.groupTitle}>
                        {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                        <span className="item-title">{group.label}</span>
                      </div>
                      <div className="item-subtitle">
                        {t('system_info.models_count', { count: group.items.length })}
                      </div>
                    </div>
                    <div className={styles.modelTags}>
                      {group.items.map((model) => (
                        <span
                          key={`${model.name}-${model.alias ?? 'default'}`}
                          className={styles.modelTag}
                          title={model.description || ''}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={t('system_info.clear_login_title')}>
          <p className={styles.sectionDescription}>{t('system_info.clear_login_desc')}</p>
          <div className={styles.clearLoginActions}>
            <Button variant="danger" onClick={handleClearLoginStorage}>
              {t('system_info.clear_login_button')}
            </Button>
          </div>
        </Card>

                <Card title="服务器迁移与域名证书">
          <p className={styles.sectionDescription}>
            保存域名、检测公网 DNS、安装证书工具、申请或导入证书、导出与导入迁移包，并支持一键重启服务。
          </p>
          <div className={styles.migrationGrid}>
            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>当前环境</label>
              <div className={`status-badge ${migrationStatus?.environment === 'test' ? 'warning' : 'success'}`}>
                {migrationStatus?.environment || 'unknown'}
              </div>
              <div className={styles.statusText}>{migrationLoading ? '正在加载迁移状态...' : '用于区分测试环境和正式环境'}</div>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>公网域名</label>
              <input
                className="input"
                value={domainDraft}
                onChange={(event) => setDomainDraft(event.target.value)}
                placeholder="example.com"
              />
              <Button onClick={() => void handleSaveDomain()} disabled={!auth.apiBase}>
                保存域名
              </Button>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>公网 DNS</label>
              <div className={`status-badge ${dnsBadgeClass}`}>{dnsBadgeText}</div>
              <Button onClick={() => void handleCheckDns()} loading={dnsChecking}>
                检测公网 DNS
              </Button>
            </div>

            {(migrationStatus?.dns_result || migrationLoading) && (
              <div className={styles.statusText}>
                {migrationLoading ? '正在加载迁移状态...' : migrationStatus?.dns_result}
              </div>
            )}

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>证书工具安装</label>
              <div className={styles.actionGroup}>
                {['certbot', 'acme.sh'].map((item) => (
                  <Button
                    key={item}
                    variant={installerStates[item]?.installed ? 'secondary' : 'primary'}
                    onClick={() => void handleInstallIssuer(item)}
                    loading={installingIssuer === item}
                    disabled={Boolean(installerStates[item]?.installed)}
                  >
                    {installerStates[item]?.installed ? `${item} 已安装` : `一键安装 ${item}`}
                  </Button>
                ))}
              </div>
              <div className={styles.statusText}>
                certbot：{installerStates.certbot?.installed ? '已安装' : '未安装'}
                {' / '}
                acme.sh：{installerStates['acme.sh']?.installed ? '已安装' : '未安装'}
              </div>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>一键申请域名证书</label>
              <select
                className={`select ${styles.providerSelect}`}
                value={certProvider}
                onChange={(event) => setCertProvider(event.target.value)}
              >
                {(migrationStatus?.available_issuers?.length ? migrationStatus.available_issuers : ['certbot', 'acme.sh']).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <Button
                onClick={() => void handleIssueCertificate()}
                loading={certIssuing}
                disabled={!hasDomain || !dnsReady || !selectedIssuerInstalled}
              >
                一键申请公网域名证书
              </Button>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>证书状态</label>
              <div className={`status-badge ${certBadgeClass}`}>
                {migrationStatus?.certificate.status === 'issued'
                  ? '证书已申请'
                  : migrationStatus?.certificate.status === 'failed'
                    ? '证书异常'
                    : '未导入'}
              </div>
              <div className={styles.statusText}>
                {migrationStatus?.certificate.message ||
                  (migrationStatus?.certificate.expires_at
                    ? `到期时间 ${new Date(migrationStatus.certificate.expires_at).toISOString().slice(0, 10).replace(/-/g, '')}`
                    : '暂无证书')}
              </div>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>自动续期</label>
              <div className={`status-badge ${migrationStatus?.renewal?.ready ? 'success' : 'muted'}`}>
                {migrationStatus?.renewal?.ready ? '已接管' : '未接管'}
              </div>
              <div className={styles.statusText}>{migrationStatus?.renewal?.message || '尚未接管自动续期'}</div>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>导入现有证书</label>
              <input ref={certFileInputRef} type="file" accept=".pem,.cer,.crt" />
              <div className={styles.actionGroup}>
                <input ref={keyFileInputRef} type="file" accept=".pem,.key" />
                <Button onClick={() => void handleImportCertificate()} loading={certImporting}>
                  导入证书
                </Button>
              </div>
            </div>

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>迁移包</label>
              <div className={styles.actionGroup}>
                <Button onClick={() => void handleExportPackage()}>一键下载迁移数据</Button>
                <Button
                  variant="secondary"
                  onClick={() => migrationPackageInputRef.current?.click()}
                  loading={packageImporting || packagePreviewing}
                >
                  上传并导入迁移包
                </Button>
                <input
                  ref={migrationPackageInputRef}
                  type="file"
                  accept=".zip"
                  className={styles.hiddenInput}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handlePreviewAndImportPackage(file);
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </div>
              <div className={styles.statusText}>
                {lastBackupPath ? `已自动备份到 ${lastBackupPath}` : '导入前会自动备份当前环境'}
              </div>
            </div>

            {lastImportPreview && (
              <div className={styles.detailGrid}>
                <div className={styles.statusText}>预检查文件数：{lastImportPreview.files.length}</div>
                <div className={styles.statusText}>
                  预检查覆盖项：{lastImportPreview.overwrite_paths?.length || 0}
                </div>
                <div className={styles.statusText}>
                  缺少关键文件：{lastImportPreview.missing_files?.length ? lastImportPreview.missing_files.join(', ') : '无'}
                </div>
              </div>
            )}

            <div className={styles.migrationRow}>
              <label className={styles.fieldLabel}>服务控制</label>
              <Button variant="danger" onClick={() => void handleRestartService()} loading={restarting}>
                一键重启服务
              </Button>
              <div className={styles.statusText}>容器环境下会优先尝试 compose，失败后走自退出来触发重启。</div>
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}



