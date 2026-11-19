require_relative "lib/trace/version"

Gem::Specification.new do |spec|
  spec.name = "trace-device"
  spec.version = Trace::VERSION
  spec.summary = "Server SDK for Trace: verify events, webhooks and sealed results, with a Rack and Rails guard."
  spec.description = "Fetch a server-recorded event, verify a webhook signature, open a sealed result and guard Rack or Rails routes. Standard library only."
  spec.license = "MIT"
  spec.authors = ["The Trace contributors"]
  spec.homepage = "https://github.com/trace-id/trace"
  spec.required_ruby_version = ">= 3.0"
  spec.files = Dir["lib/**/*.rb", "README.md"]
  spec.require_paths = ["lib"]
end
