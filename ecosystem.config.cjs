module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "pfxt-server",
      cwd: __dirname,
      script: "npm",
      args: "run start --workspace server",
      interpreter: "none",
      env_file: "./server/.env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
