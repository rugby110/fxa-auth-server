/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const crypto = require('crypto')

module.exports = config => {
  const lastAccessTimeUpdates = config.lastAccessTimeUpdates
  const signinConfirmation = config.signinConfirmation
  const signinUnblock = config.signinUnblock
  const securityHistory = config.securityHistory

  return {
    /**
     * Predicate that indicates whether updates to sessionToken.lastAccessTime
     * are enabled for a given user, based on their uid and email address.
     *
     * @param uid   Buffer or String
     * @param email String
     */
    isLastAccessTimeEnabledForUser (uid, email) {
      return lastAccessTimeUpdates.enabled && (
        isSampledUser(lastAccessTimeUpdates.sampleRate, uid, 'lastAccessTimeUpdates') ||
        lastAccessTimeUpdates.enabledEmailAddresses.test(email)
      )
    },

    /**
     * Predicate that indicates whether sign-in confirmation is enabled
     * for a given user, based on their uid and email address.
     *
     * @param uid   Buffer or String
     * @param email String
     */
    isSigninConfirmationEnabledForUser (uid, email, request) {
      if (! signinConfirmation.enabled) {
        return false
      }

      // Always create unverified tokens if customs-server
      // has said the request is suspicious.
      if (request.app.isSuspiciousRequest) {
        return true
      }

      // Or if the email address matches the regex.
      if (signinConfirmation.forcedEmailAddresses.test(email)) {
        return true
      }

      // While we're testing this feature, there may be some funky
      // edge-cases in device login flows that haven't been fully tested.
      // Temporarily avoid them for regular users by checking the `context` flag,
      // and create pre-verified sessions for unsupported clients.
      const context = request.payload &&
        request.payload.metricsContext &&
        request.payload.metricsContext.context
      if (signinConfirmation.supportedClients.indexOf(context) === -1) {
        return false
      }

      // Check to see if user in roll-out cohort.
      return isSampledUser(signinConfirmation.sample_rate, uid, 'signinConfirmation')
    },


    /**
     * Returns whether or not to use signin unblock feature on a request.
     *
     * @param account
     * @param config
     * @param request
     * @returns {boolean}
     */
    isSigninUnblockEnabledForUser(uid, email, request) {
      if (! signinUnblock.enabled) {
        return false
      }

      if (signinUnblock.forcedEmailAddresses && signinUnblock.forcedEmailAddresses.test(email)) {
        return true
      }

      if (signinUnblock.allowedEmailAddresses.test(email)) {
        return true
      }

      // While we're testing this feature, there may be some funky
      // edge-cases in device login flows that haven't been fully tested.
      // Temporarily avoid them for regular users by checking the `context` flag,
      const context = request.payload &&
        request.payload.metricsContext &&
        request.payload.metricsContext.context

      if (signinUnblock.supportedClients.indexOf(context) === -1) {
        return false
      }

      // Check to see if user in roll-out cohort.
      return isSampledUser(signinUnblock.sampleRate, uid, 'signinUnblock')
    },

    /**
     * Return whether or not this request should bypass sign-in confirmation. Currently,
     * just checks if user has had a verified security event in the past day.
     *
     * @param verified
     * @param recency
     * @returns {boolean}
     */
    canBypassSiginConfirmation(email, verified, recency) {
      // If sign-in confirmation is forced for an email, it can't be bypassed.
      if (signinConfirmation.enabled && signinConfirmation.forcedEmailAddresses.test(email)) {
        return false
      }

      // IP Profiling returns true if this user has verified a session
      // within the past day from this ip address.
      let ipProfilingEnabled = securityHistory.enabled && securityHistory.ipProfiling &&
        securityHistory.ipProfiling.enabled
      return ipProfilingEnabled && verified && recency === 'day'
    },

    /**
     * Predicate that indicates whether a user belongs to the sampled cohort,
     * based on a sample rate, their uid and a key that identifies the feature.
     *
     * @param sampleRate Number in the range 0..1
     * @param uid        Buffer or String
     * @param key        String
     */
    isSampledUser: isSampledUser
  }
}

const HASH_LENGTH = hash('', '').length
const MAX_SAFE_HEX = Number.MAX_SAFE_INTEGER.toString(16)
const MAX_SAFE_HEX_LENGTH = MAX_SAFE_HEX.length - MAX_SAFE_HEX.indexOf('f')
const COHORT_DIVISOR = parseInt(Array(MAX_SAFE_HEX_LENGTH).fill('f').join(''), 16)

function isSampledUser (sampleRate, uid, key) {
  if (sampleRate === 1) {
    return true
  }

  if (sampleRate === 0) {
    return false
  }

  if (Buffer.isBuffer(uid)) {
    uid = uid.toString('hex')
  }

  // Extract the maximum entropy we can safely handle as a number then reduce
  // it to a value between 0 and 1 for comparison against the sample rate.
  const cohort = parseInt(
    hash(uid, key).substr(HASH_LENGTH - MAX_SAFE_HEX_LENGTH),
    16
  ) / COHORT_DIVISOR
  return cohort < sampleRate
}

function hash (uid, key) {
  // Note that we don't need anything cryptographically secure here,
  // speed and a good distribution are the requirements.
  const h = crypto.createHash('sha1')
  h.update(uid)
  h.update(key)
  return h.digest('hex')
}

