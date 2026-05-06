const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Watch local workspace packages so edits in packages/* trigger HMR
config.watchFolders = [path.resolve(projectRoot, "packages")];

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// Ensure React singletons + native-only modules always resolve from the local
// project, since workspace packages may otherwise resolve duplicates.
config.resolver.extraNodeModules = {
  "expo-apple-authentication": path.resolve(projectRoot, "node_modules/expo-apple-authentication"),
  "expo-local-authentication": path.resolve(projectRoot, "node_modules/expo-local-authentication"),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-web": path.resolve(projectRoot, "node_modules/react-native-web"),
};

// Stub out native-only modules when bundling for web
const nativeOnlyModules = ["@stripe/stripe-react-native"];
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, ...args) => {
  if (platform === "web" && nativeOnlyModules.some((m) => moduleName.startsWith(m))) {
    return { type: "empty" };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform, ...args);
  }
  return context.resolveRequest(context, moduleName, platform, ...args);
};

module.exports = config;
