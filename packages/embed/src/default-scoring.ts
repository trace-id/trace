// Copy of scoring.default.json at the repository root, so createTrace() needs no file on disk.
// default-scoring.test.ts fails if the two drift apart.
export const DEFAULT_SCORING_RAW = {
  "version": 1,
  "identification": {
    "matchThreshold": 0.9,
    "tokenAgreementThreshold": 0.6,
    "minSharedWeightRatio": 0.5,
    "ambiguityMargin": 0.1,
    "maxCandidates": 50,
    "componentWeights": {
      "canvas": 3,
      "webgl": 3,
      "webglParams": 2,
      "audio": 2,
      "fonts": 3,
      "screen": 1.5,
      "hardware": 1.5,
      "timezone": 1,
      "languages": 1,
      "platform": 1,
      "math": 1,
      "css": 0.5,
      "media": 0.5,
      "userAgentFamily": 2,
      "intl": 1,
      "textMetrics": 1.5,
      "webglRender": 2,
      "webgpu": 1.5,
      "apiSurface": 1,
      "systemStyle": 1,
      "codecs": 1,
      "webgl2": 1.5,
      "extensions": 0.5,
      "appInstall": 4
    },
    "buckets": [
      [
        "canvas",
        "webgl",
        "audio"
      ],
      [
        "screen",
        "hardware",
        "timezone",
        "platform"
      ],
      [
        "fonts",
        "webglParams",
        "languages"
      ],
      [
        "appInstall"
      ]
    ],
    "method": "linkage",
    "linkage": {
      "changeRate": {
        "canvas": 0.05,
        "webgl": 0.02,
        "webglParams": 0.15,
        "audio": 0.05,
        "fonts": 0.05,
        "screen": 0.1,
        "hardware": 0.02,
        "timezone": 0.05,
        "languages": 0.03,
        "platform": 0.01,
        "math": 0.02,
        "css": 0.3,
        "media": 0.1,
        "userAgentFamily": 0.01,
        "intl": 0.03,
        "textMetrics": 0.1,
        "webglRender": 0.05,
        "webgpu": 0.1,
        "apiSurface": 0.3,
        "systemStyle": 0.05,
        "codecs": 0.1,
        "webgl2": 0.15,
        "extensions": 0.25,
        "appInstall": 0.02
      },
      "priorFrequency": {
        "canvas": 0.02,
        "webgl": 0.05,
        "webglParams": 0.05,
        "audio": 0.1,
        "fonts": 0.2,
        "screen": 0.1,
        "hardware": 0.15,
        "timezone": 0.1,
        "languages": 0.2,
        "platform": 0.4,
        "math": 0.3,
        "css": 0.2,
        "media": 0.2,
        "userAgentFamily": 0.3,
        "intl": 0.15,
        "textMetrics": 0.05,
        "webglRender": 0.03,
        "webgpu": 0.1,
        "apiSurface": 0.2,
        "systemStyle": 0.15,
        "codecs": 0.2,
        "webgl2": 0.05,
        "extensions": 0.3,
        "appInstall": 0.0001
      },
      "priorStrength": 20,
      "dependence": 0.85,
      "priorLogOdds": -2,
      "returningRate": 0.5,
      "matchProbability": 0.97,
      "minSharedComponents": 6,
      "groups": [
        [
          "canvas",
          "webgl",
          "webglParams",
          "webglRender",
          "webgpu",
          "webgl2",
          "audio"
        ],
        [
          "math",
          "css",
          "media",
          "apiSurface",
          "codecs",
          "userAgentFamily",
          "platform",
          "systemStyle"
        ],
        [
          "intl",
          "languages"
        ],
        [
          "fonts",
          "textMetrics"
        ]
      ]
    }
  },
  "suspect": {
    "weights": {
      "bot": 60,
      "tampering": 25,
      "tor": 30,
      "datacenterIp": 15,
      "ipBlocklist": 40,
      "velocity": 20,
      "incognito": 5,
      "devtools": 5,
      "virtualMachine": 15,
      "privacyBrowser": 5,
      "highActivity": 15,
      "crossBrowser": 15,
      "antiDetect": 40,
      "vpn": 20,
      "tlsMismatch": 30,
      "multiAccount": 25,
      "accountSharing": 10,
      "automatedInput": 30,
      "aiAgent": 20,
      "proxy": 20,
      "rareDevice": 10,
      "tamperedRequest": 30,
      "replayedRequest": 50,
      "flaggedNetwork": 15,
      "emulator": 30,
      "rootedDevice": 20
    }
  },
  "velocity": {
    "eventsPerVisitor1h": 60,
    "eventsPerVisitor24h": 500,
    "visitorsPerIp1h": 20,
    "ipsPerVisitor24h": 10,
    "visitorsPerLinkedId24h": 5,
    "eventsPerVisitor5m": 20,
    "countriesPerVisitor24h": 2,
    "linkedIdsPerVisitor24h": 3
  },
  "crossBrowser": {
    "weights": {
      "os": 2,
      "gpuVendor": 1,
      "gpu": 3,
      "gpuArch": 2,
      "screen": 2,
      "screenLayout": 1,
      "cpu": 1,
      "touch": 0.5,
      "timezone": 1.5,
      "language": 0.5,
      "fonts": 2.5,
      "voices": 1.5,
      "displayPrefs": 1,
      "mediaDecode": 1,
      "keyboard": 1,
      "clock": 2
    },
    "required": [
      "os",
      "gpuVendor",
      "gpu",
      "screen"
    ],
    "minSharedWeightRatio": 0.6,
    "linkThreshold": 0.7,
    "signalThreshold": 0.8,
    "requireSharedNetwork": false,
    "otherNetworkFactor": 0.75,
    "networkWindowHours": 720,
    "maxCandidates": 50,
    "busyNetworkVisitors": 20,
    "rareHardwareMaxVisitors": 3,
    "rareHardwareMinSimilarity": 0.95
  },
  "accounts": {
    "windowHours": 720,
    "maxAccountsPerDevice": 2,
    "maxDevicesPerAccount": 5
  },
  "rareDevice": {
    "minVisitors": 1000,
    "maxShare": 0.0001
  },
  "flaggedNetwork": {
    "windowHours": 24,
    "flagScore": 70,
    "minFlagged": 2,
    "minShare": 0.25
  }
} as const;
