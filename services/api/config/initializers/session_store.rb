# Persist JSON rather than Ruby objects. The store generates and hashes opaque session IDs.
ActiveRecord::SessionStore::Session.serializer = :json
