Okta Embedded Sign In Widget Example
This is a vanilla js implementation of the embedded okta sign in widget

https://github.com/okta/okta-signin-widget

https://github.com/okta/okta-auth-js

Created 2024-06-11

This example provides a number of enhancements for general implementation and user experience best practices.

![Okta Embedded Sign-In-Widget v7](https://github.com/user-attachments/assets/8b5a59bc-8f68-4409-a2e5-163bc6fc0680)


Customized Functionality
* Visual Feedback on submitting credentials
* Terms & Conditions Checkbox requirement
* Fix back button on piv error - trigger page reload
* Fix reload on session expired error for [MFA Timeout](https://support.okta.com/help/s/article/increase-mfa-timeout-for-google-authenticator?language=en_US)
* Fix reload on network changed error
* Modify links
* 508 accessibility CSS styles on anchor tags

This login page is customized with
* Okta Configs & Policies
   * To show User & Password - change global session policy to require password - otherwise "identifier first" is displayed
   * To hide "Keep me signed in" - change Security > General > Stay signed in = Disable
   * To show the PIV button configure Smart Card Identity Provider and Routing Rule for this application
* Widget Configs & Event Hooks
   * Customized logo
   * Link for Forgot Password & Unlock
   * Text changes via i18n config
   * Widget after render-identify-form event hook
     * Edit HTML DOM to insert PIV help text
     * Edit HTML DOM to move forgot password link under piv button
   * Add custom buttons, move custom buttons, click original buttons for login and piv
* Final Tweaks
   * Help link hidden via CSS
   * CSS to style containers & button elements
   * Use mutation observer to react to specific error messages
