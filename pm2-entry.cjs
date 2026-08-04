// PM2 (fork mode) loads the app entry via require(), which cannot load an ESM
// module that has top-level await anywhere in its dependency graph (e.g. baileys).
// This plain CommonJS wrapper loads synchronously (satisfying PM2's container),
// then registers tsx's ESM loader and dynamically imports the real entrypoint.
(async () => {
  const { register } = await import("tsx/esm/api");
  register();
  await import("./src/main.ts");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
