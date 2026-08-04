module.exports = {
  apps: [
    {
      name: 'main',
      script: 'pm2-entry.cjs',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
    },
  ],
};
