import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production deployment artifacts', () => {
  it('keeps the TLS proxy on a loopback upstream with bounded requests', async () => {
    const config = await readFile('deploy/nginx-content-studio.conf.example', 'utf8');

    expect(config).toContain('listen 443 ssl');
    expect(config).toContain('proxy_pass http://127.0.0.1:4173');
    expect(config).toContain('proxy_set_header Origin $http_origin');
    expect(config).toContain('proxy_set_header Sec-Fetch-Site $http_sec_fetch_site');
    expect(config).toContain('client_header_timeout 15s');
    expect(config).toContain('client_body_timeout 60s');
    expect(config).toContain('proxy_read_timeout 60s');
    expect(config).toContain('location = /api/fal/jobs');
    expect(config).toContain('client_max_body_size 40m');
    expect(config).toContain('error_page 413 = @body_too_large');
    expect(config).toContain('"code":"REQUEST_BODY_TOO_LARGE"');
    expect(config).not.toMatch(/proxy_pass\s+https?:\/\/(?!127\.0\.0\.1:4173)/);
  });

  it('routes structured service logs to journald with a stable identifier', async () => {
    const service = await readFile('deploy/content-studio.service.example', 'utf8');

    expect(service).toContain('StandardOutput=journal');
    expect(service).toContain('StandardError=journal');
    expect(service).toContain('SyslogIdentifier=content-studio');
    expect(service).toContain('Restart=on-failure');
    expect(service).toContain('KillSignal=SIGTERM');
  });
});
