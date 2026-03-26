module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "pfxt_wghappy_cn",
      cwd: __dirname,
      script: "./server/dist/src/index.js",
      env_file: "./server/.env",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3100",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
  ],
};
