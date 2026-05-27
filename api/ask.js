// Vercel serverless function: /api/ask
// Proxies requests to Groq using their OpenAI-compatible API.
// Returns responses in Anthropic-shape so the frontend doesn't need changes.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY env var not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Translate Anthropic-style {system, messages} to OpenAI-style messages
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: body.system });
  for (const m of body.messages || []) {
    messages.push({ role: m.role, content: m.content });
  }

  const payload = {
    model: body.model || 'llama-3.3-70b-versatile',
    messages,
    max_tokens: body.max_tokens || 1000,
    temperature: 0.3,
    response_format: { type: 'json_object' }
  };

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    // Repackage as Anthropic-shape so frontend code keeps working
    const text = data.choices?.[0]?.message?.content || '';
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Upstream fetch failed' }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    });
  }
}
