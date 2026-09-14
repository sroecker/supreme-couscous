// Runs the packaged review workflow, then real CLI investigations with both models.
exports.run = async () => {
  await require('./reliability-editor').run();
  await require('./editor').run();
};
