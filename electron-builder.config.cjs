// Standalone installer only. Steam consumes the same prepackaged app directory.
module.exports = {
  appId: 'io.github.zhoujoe194maker.doctorgame',
  productName: 'doctorgame',
  artifactName: 'doctorgame-${version}-win-${arch}-setup.${ext}',
  directories: { buildResources: 'build', output: 'release/installers' },
  asar: true,
  npmRebuild: false,
  compression: 'normal',
  publish: null,
  forceCodeSigning: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/doctorgame.ico',
    // This beta is intentionally unsigned. Runtime resources are set by packager.
    signAndEditExecutable: false
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    allowToChangeInstallationDirectory: true,
    createStartMenuShortcut: true,
    createDesktopShortcut: true,
    shortcutName: 'doctorgame',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    differentialPackage: false,
    installerLanguages: ['zh_CN', 'en_US'],
    language: '2052'
  }
};
