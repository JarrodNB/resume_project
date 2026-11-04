# Sign-up's rules about email addresses: which domains are refused, which addresses count as one
# mailbox, and how many new accounts one domain may create in a day. Only used to decide limits.
# The stored email address never changes, so person+jobs@example.com stays exactly that.
# Index:
#   - disposable?: the domain, or a parent of it, is a throwaway mail service
#   - mailbox: the address without its +tag, for rate limiting
#   - domain_limit_reached?: counts this new account against its domain's daily cap
module Accounts
  module SignUpEmailRules
    DOMAIN_DAILY_LIMIT = Integer(ENV.fetch("SIGN_UP_DOMAIN_DAILY_LIMIT", "20"))
    DISPOSABLE_DOMAINS = Rails.root.join("config/disposable_email_domains.txt").readlines(chomp: true)
      .reject { |line| line.blank? || line.start_with?("#") }.to_set.freeze
    # Anyone can get an address at these, so many sign-ups in a day say nothing about abuse.
    PUBLIC_PROVIDER_DOMAINS = %w[
      gmail.com googlemail.com outlook.com hotmail.com hotmail.co.uk live.com msn.com
      yahoo.com yahoo.co.uk ymail.com rocketmail.com icloud.com me.com mac.com aol.com
      proton.me protonmail.com pm.me gmx.com gmx.de gmx.net web.de mail.com fastmail.com
      zoho.com hey.com yandex.com yandex.ru mail.ru qq.com 163.com 126.com naver.com
      comcast.net verizon.net att.net sbcglobal.net cox.net
    ].to_set.freeze

    def self.disposable?(email)
      labels = domain_of(email).split(".")
      labels.each_index.any? { |index| DISPOSABLE_DOMAINS.include?(labels[index..].join(".")) }
    end

    def self.mailbox(email)
      local = email.strip.downcase.rpartition("@").first
      "#{local.split('+', 2).first.presence || local}@#{domain_of(email)}"
    end

    # Call once per new account. Counts the registrable domain, so a.example.com and b.example.com
    # share one cap. A cache eviction restarts the count, which is fine for a soft limit.
    def self.domain_limit_reached?(email)
      domain = PublicSuffix.domain(domain_of(email)) || domain_of(email)
      return false if PUBLIC_PROVIDER_DOMAINS.include?(domain)
      Rack::Attack.cache.count("sign_up/domain/#{domain}", 1.day.to_i) > DOMAIN_DAILY_LIMIT
    end

    def self.domain_of(email)
      email.strip.downcase.rpartition("@").last.delete_suffix(".")
    end
    private_class_method :domain_of
  end
end
