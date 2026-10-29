# Storage is accessed by server-side blob keys or scoped interview grants. Default
# Active Storage routes must never expose a second, unauthenticated upload API.
require "rails_helper"

RSpec.describe "Storage routes" do
  [
    [ :post, "/rails/active_storage/direct_uploads" ],
    [ :put, "/rails/active_storage/disk/upload-token" ],
    [ :get, "/rails/active_storage/blobs/redirect/signed-id/resume.pdf" ],
    [ :get, "/rails/active_storage/representations/redirect/signed-id/variation/resume.pdf" ]
  ].each do |method, path|
    it "does not route #{method} #{path}" do
      expect { Rails.application.routes.recognize_path(path, method: method) }
        .to raise_error(ActionController::RoutingError)
    end
  end

  it "retains the authenticated upload transport" do
    route = Rails.application.routes.recognize_path("/graphql", method: :post)
    expect(route).to include(controller: "graphql", action: "execute")
  end
end
