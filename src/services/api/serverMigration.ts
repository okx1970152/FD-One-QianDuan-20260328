import { apiClient } from './client';

export interface ServerMigrationCertificateState {
  provider?: string;
  status: string;
  issued_at?: string;
  expires_at?: string;
  cert_path?: string;
  key_path?: string;
  message?: string;
  importable?: boolean;
}

export interface ServerMigrationStatus {
  domain?: string;
  dns_status: string;
  dns_result?: string;
  dns_checked_at?: string;
  certificate: ServerMigrationCertificateState;
  tls: {
    enabled: boolean;
    cert_path?: string;
    key_path?: string;
  };
  available_issuers?: string[];
  installers?: Record<string, { installed: boolean; message?: string }>;
  renewal?: {
    provider?: string;
    ready: boolean;
    message?: string;
  };
  environment?: string;
}

export interface ServerMigrationDnsResult {
  status: string;
  domain?: string;
  public_ip?: string;
  resolved_ips?: string[];
  message?: string;
  checked_at?: string;
  matches_current?: boolean;
}

export interface ServerMigrationImportPreview {
  files: string[];
  overwrite_paths?: string[];
  missing_files?: string[];
  warnings?: string[];
}

export interface ServerMigrationImportResult {
  imported: string[];
  skipped?: string[];
  message?: string;
  backup_path?: string;
}

export const serverMigrationApi = {
  getStatus: () => apiClient.get<ServerMigrationStatus>('/server-migration'),

  saveDomain: (domain: string) => apiClient.put('/server-migration/domain', { domain }),

  checkDns: () => apiClient.post<ServerMigrationDnsResult>('/server-migration/dns-check'),

  installIssuer: (provider: string) =>
    apiClient.post('/server-migration/certificate/install', { provider }),

  issueCertificate: (provider: string) =>
    apiClient.post('/server-migration/certificate/issue', { provider }),

  importCertificate: async (certFile: File, keyFile: File, provider = 'imported') => {
    const formData = new FormData();
    formData.append('cert', certFile);
    formData.append('key', keyFile);
    formData.append('provider', provider);
    return apiClient.postForm('/server-migration/certificate/import', formData);
  },

  exportPackage: () =>
    apiClient.getRaw('/server-migration/export', {
      responseType: 'blob',
    }),

  importPackage: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.postForm<ServerMigrationImportResult>('/server-migration/import', formData);
  },

  previewImportPackage: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.postForm<ServerMigrationImportPreview>('/server-migration/import/preview', formData);
  },

  restartService: () => apiClient.post('/server-migration/restart'),
};
