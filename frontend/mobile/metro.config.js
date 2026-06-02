const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.transformer.unstable_transformProfile = "hermes-canary";

// Rewrite bundle URLs to use the Cloudflare tunnel (no port suffix)
const TUNNEL_HOST = process.env.TUNNEL_HOST;
if (TUNNEL_HOST) {
  const originalMiddleware = config.server?.enhanceMiddleware;
  config.server = {
    ...config.server,
    enhanceMiddleware: (middleware, server) => {
      const enhanced = originalMiddleware ? originalMiddleware(middleware, server) : middleware;
      return (req, res, next) => {
        if (req.url === "/" || req.url?.startsWith("/?")) {
          const origWrite = res.write.bind(res);
          const origEnd = res.end.bind(res);
          let body = "";
          res.write = (chunk) => { body += chunk; return true; };
          res.end = (chunk) => {
            if (chunk) body += chunk;
            try {
              const data = JSON.parse(body);
              if (data.bundleUrl) {
                data.bundleUrl = data.bundleUrl.replace(
                  /http:\/\/[^:]+:8081/,
                  `https://${TUNNEL_HOST}`
                );
              }
              if (data.debuggerHost) {
                data.debuggerHost = `${TUNNEL_HOST}:443`;
              }
              const newBody = JSON.stringify(data);
              res.setHeader("Content-Length", Buffer.byteLength(newBody));
              origEnd(newBody);
            } catch {
              origEnd(body);
            }
          };
        }
        return enhanced(req, res, next);
      };
    },
  };
}

module.exports = config;
