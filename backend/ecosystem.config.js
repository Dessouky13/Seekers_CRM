module.exports = {
  apps: [{
    name:    "seekersai-api",
    script:  "node",
    args:    "dist/index.js",
    cwd:     "/var/www/seekersai/backend",
    env_production: {
      NODE_ENV: "production",
      PORT:     3000,
    },
    instances:          1,
    autorestart:        true,
    watch:              false,
    max_memory_restart: "512M",
    error_file:         "/var/log/pm2/seekersai-error.log",
    out_file:           "/var/log/pm2/seekersai-out.log",
    log_date_format:    "YYYY-MM-DD HH:mm:ss Z",
  }],
};
