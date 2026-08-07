// PM2 process configuration for POSNIC ApiV2
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/
//
// NOTE: fork mode with a SINGLE instance is deliberate. whatsapp-web.js runs a
// headless Chromium and keeps a stateful WhatsApp session on disk (.wwebjs_auth).
// Running multiple instances would fight over the same Chromium user-data dir and
// corrupt the session, so DO NOT switch this to cluster mode / multiple instances.
module.exports = {
  apps: [
    {
      name: "apiv2",
      script: "server.js",
      cwd: "/home/ubuntu/apiv2",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1500M",
      env: {
        NODE_ENV: "production",
      },
      // Combined + timestamped logs, kept under the app dir
      time: true,
      out_file: "/home/ubuntu/apiv2/logs/pm2-out.log",
      error_file: "/home/ubuntu/apiv2/logs/pm2-error.log",
      merge_logs: true,
    },
  ],
};
