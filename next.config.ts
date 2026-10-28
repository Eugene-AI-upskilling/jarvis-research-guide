import type { NextConfig } from 'next';

// Sites allowed to show JARVIS in a popup (iframe), space-separated,
// e.g. "https://research.example.com https://www.example.com".
const embedOrigins = (process.env.EMBED_ALLOWED_ORIGINS ?? '').trim();

const config: NextConfig = {
  reactStrictMode: true,
  // Hide the dev-mode indicator bubble — it shows inside the Insight Lab home Hero iframe.
  devIndicators: { buildActivity: false, appIsrStatus: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${embedOrigins}`.trim() }],
      },
    ];
  },
  // Keep Node-only deps out of the build pipeline — transformers.js automatically
  // falls through to its WASM browser backend when these are unavailable.
  serverExternalPackages: ['onnxruntime-node', '@huggingface/transformers'],
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      type: 'asset/source',
    });
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, false | string>),
      // Replace native Node bindings with empty modules on the client bundle
      'onnxruntime-node': false,
      sharp: false,
    };
    return config;
  },
};

export default config;
