const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const CIDR_PATTERN = /^((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))\/(\d|[12]\d|3[0-2])$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const HOST_PORT_PATTERN = /^(.+):(\d{1,5})$/;
const SECRET_URL_FIELDS = ['username', 'password'];

function ipToInt(ip) {
  if (!IPV4_PATTERN.test(ip)) return null;
  return ip.split('.').map(Number).reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function isPrivateIp(ip) {
  const value = ipToInt(ip);
  if (value === null) return false;
  const ranges = [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
  ];
  return ranges.some(([base, bits]) => {
    const baseInt = ipToInt(base);
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((baseInt & mask) >>> 0);
  });
}

function tokenize(input) {
  return String(input || '')
    .split(/[\s,;]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function normalizeUrl(raw) {
  const parsed = new URL(raw);
  for (const field of SECRET_URL_FIELDS) parsed[field] = '';
  return parsed.toString().replace(/\/$/, '');
}

function targetId(type, value) {
  return `${type}:${value}`.toLowerCase();
}

export function classifyTargetValue(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const value = normalizeUrl(raw);
    const host = url.hostname.toLowerCase();
    return {
      id: targetId('url', value),
      type: 'url',
      value,
      host,
      port: url.port ? Number(url.port) : null,
      protocol: url.protocol.replace(':', ''),
      visibility: IPV4_PATTERN.test(host) && isPrivateIp(host) ? 'private' : 'public',
    };
  } catch {}

  const cidr = raw.match(CIDR_PATTERN);
  if (cidr) {
    const value = `${cidr[1]}/${Number(cidr[2])}`;
    return { id: targetId('cidr', value), type: 'cidr', value, visibility: isPrivateIp(cidr[1]) ? 'private' : 'public' };
  }

  const hostPort = raw.match(HOST_PORT_PATTERN);
  if (hostPort) {
    const host = hostPort[1].replace(/^\[|\]$/g, '').toLowerCase();
    const port = Number(hostPort[2]);
    if (port > 0 && port <= 65535 && (IPV4_PATTERN.test(host) || DOMAIN_PATTERN.test(host))) {
      return {
        id: targetId('host_port', `${host}:${port}`),
        type: 'host_port',
        value: `${host}:${port}`,
        host,
        port,
        visibility: IPV4_PATTERN.test(host) && isPrivateIp(host) ? 'private' : 'public',
      };
    }
  }

  const value = raw.toLowerCase();
  if (IPV4_PATTERN.test(value)) {
    return { id: targetId('host', value), type: 'host', value, visibility: isPrivateIp(value) ? 'private' : 'public' };
  }
  if (DOMAIN_PATTERN.test(value)) {
    return { id: targetId('domain', value), type: 'domain', value, visibility: 'public' };
  }
  return null;
}

export function parseTargetInput(input) {
  const byId = new Map();
  const errors = [];
  const lines = String(input || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  for (const line of lines.length ? lines : ['']) {
    const invalid = [];
    let validCount = 0;
    for (const token of tokenize(line)) {
      const target = classifyTargetValue(token);
      if (!target) {
        invalid.push(token);
        continue;
      }
      validCount += 1;
      byId.set(target.id, target);
      if (target.type === 'host_port') {
        const hostTarget = classifyTargetValue(target.host);
        if (hostTarget) byId.set(hostTarget.id, hostTarget);
      }
    }
    if (invalid.length && validCount === 0) errors.push({ input: line, reason: 'Unrecognized target format' });
    else for (const token of invalid) errors.push({ input: token, reason: 'Unrecognized target format' });
  }
  return { targets: Array.from(byId.values()), errors };
}

export function targetsToScopeFields(targets = []) {
  const fields = { hosts: [], domains: [], cidrs: [], urls: [], hostPorts: [] };
  const add = (key, value) => {
    if (value && !fields[key].includes(value)) fields[key].push(value);
  };
  for (const target of targets || []) {
    if (target.type === 'host') add('hosts', target.value);
    else if (target.type === 'domain') add('domains', target.value);
    else if (target.type === 'cidr') add('cidrs', target.value);
    else if (target.type === 'url') add('urls', target.value);
    else if (target.type === 'host_port') {
      add('hostPorts', target.value);
      add('hosts', target.host);
    }
  }
  return fields;
}
