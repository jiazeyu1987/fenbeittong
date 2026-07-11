export async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('request body must be valid JSON');
  }
}

export function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(JSON.stringify(body));
}

export function sendError(response, error) {
  const statusCode = error.statusCode || 400;
  sendJson(response, statusCode, {
    success: false,
    error: {
      code: error.code || 'REQUEST_FAILED',
      message: error.message,
      detail: sanitize(error.detail || {})
    }
  });
}

function sanitize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|password|secret|key|authorization|auth/i.test(key)) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = sanitize(item);
    }
  }
  return safe;
}
