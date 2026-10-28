# frozen_string_literal: true

# Description: Single GraphQL endpoint. Requires a valid browser session and passes the user into context.
# Index:
#   - execute: runs a GraphQL query or mutation
#   - prepare_variables: normalizes variables from JSON, form data, or blank
class GraphqlController < ApplicationController
  before_action :authenticate_user!

  # Runs the GraphQL operation for the signed-in user.
  def execute
    result = ApiSchema.execute(
      params[:query],
      variables: prepare_variables(params[:variables]),
      context: { current_user: current_user, browser_session_id: session.id },
      operation_name: params[:operationName]
    )
    render json: result
  rescue StandardError => e
    raise e unless Rails.env.development?
    handle_error_in_development(e)
  end

  private

  # Normalizes variables from a JSON string, a hash, or nothing.
  def prepare_variables(variables_param)
    case variables_param
    when String
      variables_param.present? ? JSON.parse(variables_param) || {} : {}
    when Hash
      variables_param
    when ActionController::Parameters
      variables_param.to_unsafe_hash # GraphQL-Ruby validates variable names and types.
    when nil
      {}
    else
      raise ArgumentError, "Unexpected parameter: #{variables_param}"
    end
  end

  # Renders the error and backtrace (development only).
  def handle_error_in_development(error)
    logger.error error.message
    logger.error error.backtrace.join("\n")

    render json: { errors: [ { message: error.message, backtrace: error.backtrace } ], data: {} }, status: 500
  end
end
