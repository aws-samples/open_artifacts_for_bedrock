module.exports = {
    apps: [{
      name: "artifacts",
      script: "yarn",
      args: "run dev -- -H 0.0.0.0",
      interpreter: "/bin/bash"
    }]
  }