"use strict";

const oktaTenant = 'dev-8675309'

// TOTP MFA seed
const totpSeed = 'STXYMWG3AZFRCEQ3'

const oktaAuthInstance = new OktaAuth({
  //custom auth server
  //issuer: 'https://auth.importantcompany.com/oauth2/auseizqihsBSLpXuq697',
  //scopes: ['openid','profile','email','offline_access'],
  //for okta scopes, must use org auth server:
  issuer: 'https://auth.importantcompany.com/',
  scopes: [
    'openid',
    'profile',
    'email',
    'okta.users.read.self',
    'okta.myAccount.authenticators.read',
    //'okta.authenticators.manage.self',
    //'okta.users.manage.self',
  ],
  
  //okta organization url
  //issuer: 'https://dev-8675309.okta.com/',
  //scopes: ['openid','profile','email','okta.users.read.self'],
  //"Browser requests to the token endpoint may not include the offline_access scope."
  
  clientId: '0oaf5ifoceyJZoa4et697',
  redirectUri: 'https://importantcompany.com/login/',
  
  //disable interaction code grant? //check your script tags - use the correct widget distribution
  // note css styling drastically changes when you flip this
  //useClassicEngine:true,
  
  services: {
    autoRenew: true, //automatically renew refresh tokens when they are close to expiration
    autoRemove: true, //automatically remove expired tokens
    syncStorage: true, //sync tokens between browser tabs
  },
})

const signIn = new OktaSignIn({
  clientId: oktaAuthInstance.options.clientId,
  redirectUri: oktaAuthInstance.options.redirectUri,
  issuer: oktaAuthInstance.options.issuer,
  scopes: oktaAuthInstance.options.scopes,
  authClient:oktaAuthInstance,
  rememberMe: false,
  logo: 'https://ok14static.oktacdn.com/fs/bco/4/fs0foccjd4fzM5pKk697',
  helpLinks: {
    forgotPassword: 'http://example.com/forgot',
    unlock: 'http://example.com/unlock',
    //help:'http://example.com/', //changes url only - ie false doesn't hide
  },
  i18n: {
    en: {
      //all constants here: https://github.com/okta/okta-signin-widget/blob/okta-signin-widget-7.19.1/packages/%40okta/i18n/src/properties/login.properties
      'primaryauth.username.placeholder': 'User ID',
      'piv.cac.card': 'PIV Card Only',
      'oform.errorbanner.title': 'Please complete all required fields.',
      'unlockaccount': 'Unlock Account',
      'forgotpassword' : 'Forgot Password',
    }
  },
  customButtons: [
    //fake buttons to be used to intercept the login process
    {
      title: 'Sign In',
      className: 'sign-in-clone',
      click: termsVerifyBeforeSignIn,
    },
    {
      title: 'PIV Card Only',
      className: 'piv-clone',
      click: termsVerifyBeforePiv,
    },
  ],
})

const issuer = new URL(oktaAuthInstance.options.issuer)
const issuerHost = issuer.protocol+'//'+issuer.host

let firstRenderComplete = false
let activeContext = null
let redirectBeingHandledFlag = false

initSpaApp()

async function initSpaApp() {
  console.log('initSpaApp')
    
  oktaAuthInstance.authStateManager.subscribe(function (authState) {
    console.log('authStateManager!',authState)

    if (authState.isAuthenticated) {
        // Render authenticated view
        console.log('Logged IN!')

        signIn.remove()

        getTokensFromStorageShowLoggedIn()
    } else {
        // Render unathenticated view
        console.log('Logged OUT!')
        updateUiAuthenticatedStatus(false)

        //if already handling a login, don't initiate another login
        //this is for piv
        if(!redirectBeingHandledFlag){  
          showLoginWidget() 
        }else{
          //clear flag
          redirectBeingHandledFlag = false
        }
    }
    
  })
  
  attachWidgetListeners()
  
  
  //handle PIV mtls redirect:
  if (oktaAuthInstance.isLoginRedirect()) {
      console.log('yes is redirect!')
    try {
      redirectBeingHandledFlag = true
      //verify auth status
      startOktaService()
      
      await oktaAuthInstance.handleRedirect()
    } catch (error) {
      console.log('handleRedirect error!',error)
    }
  }else{
    //check current auth status
    startOktaService() // calls authStateManager.updateAuthState()
  }
  
  //bugfix for back button - prevent page cache to re-render after piv fails and you hit back
  document.body.onunload=function(){}
}
function showLoginWidget(){
  
  //when promise resolves the user tokens are provided!
  signIn.showSignIn({el: '#login-container'}).then(function(result) {
    console.log('showSignIn then',result)
    
    //hide widget
    signIn.remove()
    
    hideElement("loading-container")
    
    console.log('result.tokens',result.tokens)
    
    oktaAuthInstance.tokenManager.setTokens(result.tokens)
    
  }).catch(function(error) {
    //catch errors from the token request
  
    console.log('showSignIn catch error',error)
    
    //hide widget
    //signIn.remove()
    
    //hide loading spinner
    hideElement("loading-container")
    
    //show error msg
    document.getElementById("error").innerHTML = 'Error Requesting Token! <BR /><B>'+error+'</B><BR /><button onclick="location.reload()">Refresh Page</button>'
  })
}

function attachWidgetListeners(){
  signIn.on('afterRender', function (context) {
    console.log('signIn on afterRender context',context)
       
    activeContext = context

    if(!firstRenderComplete){
      firstRenderComplete = true
      hideElement('loading-container')
      showElement('logged-out-container')
      
      //check for errors passed in query string
      const urlParams = new URLSearchParams(window.location.search)
      const error = urlParams.get('error')
      if(error){
        const error_description = urlParams.get('error_description')
        console.log('Redirect error found in url!',error,error_description)
        if(error_description){
          showRedirectError(error_description) 
        }
        //clear error from address bar
        history.pushState({}, "", "/");      
      }
  
    }
    
    //watch the error element for child changes and hide the loading spinner if we see the specific error string
    const observer = new MutationObserver((e)=>{
      console.log('.o-form-error-container childList change')
      if(document.querySelector('.o-form-error-container').innerHTML.includes("Please complete all required fields") ){
        hideElement('widget-loading-spinner') 
      }
    })
    observer.observe(document.querySelector('.o-form-error-container'), {childList:true})
    
    //if you dont respond to mfa within 5 minutes you get a "session expired" error when you refresh. why does okta do that?
    if(context.formName === "terminal"){
      let errorString = document.querySelector('.o-form-error-container')?.innerHTML
      if(errorString.includes("You have been logged out due to inactivity")
         // || errorString.includes("There was an unexpected internal error") // this triggers on config errors and may show user a reloading loop
        ){ 
        location.reload()
      }
    }
    
  })
  
  signIn.on('afterError', function (context, error) {
    console.log('signIn.on afterError',error)
    
    //hide widget loading spinner when the user enters password wrong
    //note this does not trigger when the user clicks submit with a blank password
    hideElement('widget-loading-spinner')
  })

  signIn.after('identify',async ()=>{
    setTimeout(function(){
      applyWidgetCustomizations()
    },1)
  })
}

function applyWidgetCustomizations(){
  //global parent element keydown event handler to intercept form submits via enter key
  document.querySelector("div.primary-auth").addEventListener('keydown', (event)=>{
       
    if(event.key === "Enter"){
      //if you hit enter on a link dont intercept
      if(event.target.tagName==='A'){
        return 
      }
      if(!termsVerifyChecked()){
        termsShowError()
        event.preventDefault()
        return
      }
      showElement('widget-loading-spinner')
    }
  })

  if(!document.querySelector(".okta-form-title #widget-loading-spinner")){
    const widgetLoadSpin = document.createElement('div')
    widgetLoadSpin.id="widget-loading-spinner"
    widgetLoadSpin.className="hide-element"
    document.querySelector(".okta-form-title").append(widgetLoadSpin)
  }
  hideElement('widget-loading-spinner')

  //Add terms and conditions checkbox
  if(!document.querySelector(".o-form-button-bar #t-and-c")){
    const tncEl = document.createElement('div')
    tncEl.innerHTML = '<div id="t-and-c" style="display: flex;">' +
               '<input style="margin-right: 5px;" type="checkbox" title="Agree to terms and conditions" id="tandc" name="tandc"/>' +
               '<label for="tandc">Agree to our ' + 
                 '<a href="#" title="View terms and conditions" id="tnc-href" onClick="clickShowTermsConditions(); return false;">Terms & Conditions</a>' +
               '</label>' + 
            '</div>'
    document.querySelector(".o-form-button-bar").prepend(tncEl)

    const termsCheckbox = document.getElementById("tandc")
    termsCheckbox.addEventListener('change',termsCheckChange)
  }

  //remove second separation line
  document.querySelector("div.custom-buttons div.separation-line").remove()

  //move forgot password link to under PIV button
  if(!document.querySelector(".auth-footer a[data-se='forgot-password']")){
    document.querySelector(".auth-footer").prepend(document.querySelector("a[data-se='forgot-password']"))
  }

  //move sign in clone to above sign in
  const existingSubmitButton = document.querySelector("input[type='submit'].button")
  existingSubmitButton.parentNode.insertBefore(document.querySelector("a.sign-in-clone"),existingSubmitButton)

  //if piv help text isn't present - add it
  if(!document.querySelector("#piv-help-text")){

    const pivEl = document.createElement('div')
    pivEl.id="piv-help-text"
    pivEl.innerHTML = "<p><b>PIV Users: </b>To activate the PIV functionality, you must first sign in using your Issued ID and password during your initial login.</p>"
    document.querySelector(".o-form-button-bar").append(pivEl)
  }
}
function termsCheckChange(event){
  //hide error immediately upon checking agree
  if(event.target.checked){
    termsHideError()
    redirectHideError()
  }
  //else{
      //show error on uncheck?
  //  termsShowError()
  //}
}
function termsVerifyChecked(){
  return document.querySelector("input#tandc").checked
}

function termsVerifyBeforeSignIn(event){
  console.log('termsVerifyBeforeSignIn', event)
  
  //only accept single click
  if(event.detail !== 1){
    return
  } 
  if(termsVerifyChecked()) {
    //show loading spinner
    showElement('widget-loading-spinner')
    //click sign in button
    document.querySelector("div.primary-auth input[type='submit'].button").click()
  }else{
    termsShowError()
  }
}
function termsVerifyBeforePiv(){
  //only accept single click
  if(event.detail !== 1){
    return
  }
  if(termsVerifyChecked()) {
    //click piv button
    document.querySelector("div.primary-auth a[data-se='piv-card-button']").click()
  }else{
    termsShowError()
  }
}

function showRedirectError(error) {
  const errorContainer = document.querySelector('.o-form-error-container')

  const redirectError = document.createElement('div')
  //termsError.id = 'redirectError'
  redirectError.innerHTML = `<div id="redirecterror" class="okta-form-infobox-error infobox infobox-error" role="alert"><span class="icon error-16"></span><p>${error}</p></div></div>`
  errorContainer.innerHTML = ''
  errorContainer.classList.add('o-form-has-errors')
  errorContainer.appendChild(redirectError)
}
function termsShowError() {
  const errorContainer = document.querySelector('.o-form-error-container')

  const termsError = document.createElement('div')
  //termsError.id = 'tandcError'
  termsError.innerHTML = '<div id="termserror" class="okta-form-infobox-error infobox infobox-error" role="alert"><span class="icon error-16"></span><p>Please agree to the Terms & Conditions.</p></div></div>'
  errorContainer.innerHTML = ''
  errorContainer.classList.add('o-form-has-errors')
  errorContainer.appendChild(termsError)
}
function redirectHideError(){
  const redirectErrorEl = document.querySelector('#redirecterror')
  if(redirectErrorEl){
    redirectErrorEl.parentNode.removeChild(redirectErrorEl)
  }
}
function termsHideError(){
  const termsErrorEl = document.querySelector('#termserror')
  if(termsErrorEl){
    termsErrorEl.parentNode.removeChild(termsErrorEl)
  }
}
function clickShowTermsConditions(){
  showElement('tnc')
}
function clickHideTermsConditions(){
  hideElement('tnc')
}
function clickPaperwork(){
  alert("According to the Paperwork Reduction Act of 1995, no persons are required to respond to a" +
  " collection of information unless it displays a valid OMB control number. The valid OMB control" +
  " number for this information collection is 0867-5309. The time required to complete this information" +
  " collection is estimated to average 20 minutes per response, including the time to review instructions," +
  " search existing data resources, gather the data needed, and complete and review the information" + 
  " collection.  If you have comments concerning the accuracy of the time estimate(s) or suggestions for" + 
  " improving this form, please write to: DHS, 7500 Security Boulevard, Attn: PRA Reports Clearance" +
  " Officer, Mail Stop C4-26-05, Baltimore, Maryland 21244-1850.");
}
async function startOktaService() {
  await oktaAuthInstance.start()
}
function getTokensFromStorageShowLoggedIn() {
  oktaAuthInstance.tokenManager.get('idToken').then(idToken => {
    if (idToken) {
        console.log('Token storage has ID Token',idToken)

        hideElement("loading-container")
        updateUiAuthenticatedStatus(true, idToken)
    } else {
        console.log('Token storage DOES NOT have ID Token')
    }
  })
}
function updateUiAuthenticatedStatus(authenticated, idToken) {

  if (authenticated) {
    hideElement('logged-out-container')
    showElement('logged-in-container')
    setInnerText('name', idToken.claims.name) //provided by profile scope
    setInnerText('email', idToken.claims.email) //provided by email scope
  } else {
    showElement('logged-out-container')
    hideElement('logged-in-container')
    setInnerText('name', '')
    setInnerText('email', '')
    clickHideTokens()
  }
}

async function clickMfa(){
  let value
  try {
    value = await totp(totpSeed)
  }catch(e){
    console.error('error generating totp',e)
  }
  document.getElementById('totp-code').value = value
}
async function clickLogMeIn(){
  console.log('activeContext',activeContext)
  if(activeContext?.controller === 'mfa-verify' && activeContext?.formName ==='challenge-authenticator'){
    autofillMfaAndSubmit()
    return
  }
  
  //if you have an existing session you go straight to the password or mfa inputs and entering user and agreeing to terms can be skipped
  if(activeContext?.controller === 'primary-auth' && activeContext?.formName ==='identify' ){
    
    //input user name
    let user = document.querySelector('input[name="identifier"]')
    let userVal = "test@test.com";
    //check for autofill
    if(user.value !== userVal){
      await simulateTyping(user,"test@test.com") 
    }
    
    //check agree to terms
    document.querySelector("input#tandc").checked = true
  }

  //input password
  let pass = document.querySelector('input[name="credentials.passcode"]')
  await simulateTyping(pass,"Secret123$")
  
  //click the appropriate button based on the form type
  if(activeContext?.controller === 'primary-auth' && activeContext?.formName ==='identify' ){
        //click log on button
    let event = new Event("click", { bubbles: true, cancelable: true })
    event.detail=1
    document.querySelector("a.sign-in-clone.default-custom-button").dispatchEvent(event)
  }
  if(activeContext?.formName === 'challenge-authenticator' ){
    document.querySelector('input.button-primary[type="submit"]').click()
  }
  
  //wait 2 seconds to input mfa
  window.setTimeout(()=>{
    
    //if you dont have the authenticator cookie set you have to select one first
    if(activeContext?.formName ==='select-authenticator-authenticate'){
      clickGoogleAuthenticator()
      return
    }
    
    autofillMfaAndSubmit()
  },2000)
}
function clickGoogleAuthenticator(){
  document.querySelector('a[aria-label="Select Google Authenticator."]').click()
  
  window.setTimeout(()=>{  
    autofillMfaAndSubmit()
  },600)
}
async function autofillMfaAndSubmit(){
    //click mfa button just for visuals
    document.querySelector("button#mfa-button").click()
    
    let codeField = document.querySelector('input[name="credentials.passcode"]')
    await simulateTyping(codeField,await totp(totpSeed))
    
    document.querySelector('input.button-primary[type="submit"]').click()
  
    //after logging in, scroll to the top of the page
    window.setTimeout(()=>{  
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },1000)
    
}
async function simulateTyping(field, text) {
  field.focus()
  
  const len = text.length;
  for(let i = 1; i <= len; i++) {
    field.value = text.slice(0,i)
    await new Promise(resolve => setTimeout(resolve, 90))
  }
  field.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
}
async function clickAjaxPiv(){
  //clicking this button will do an ajax request to the MTLS endpoint so we can get the error message. If this succeeds we can click the widget piv button and it is likely to succeed.
  
  showElement('widget-loading-spinner')
  
  const pivUrl = `https://${oktaTenant}.mtls.okta.com/api/internal/v1/authn/cert`
    
  const pivOutput = document.getElementById("pivOutput")
  
  try {
    const response = await fetch(pivUrl,
    {
      method: 'POST',
      credentials: 'include', //firefox fix
      body: JSON.stringify({ isCustomDomain:true })
    })
    
    //hide loding indicator
    hideElement('widget-loading-spinner')
    
    if (response.ok) {
      //click widget piv button!
      document.querySelector("div.primary-auth a[data-se='piv-card-button']").click()
      return
    }else{
      console.error(response)
      
      
      //output error message
      pivOutput.innerHTML = `<B>Error</B> Calling ${pivUrl}<BR\><PRE>${response.status} ${response.statusText}</PRE>`
      try{
        const json = await response.json()
        pivOutput.innerHTML = pivOutput.innerHTML + JSON.stringify(json,null,4)
        
        showRedirectError('PIV Login Failed!<BR>'+json?.errorSummary) 
      }catch(err){
        console.log('mtls response invalid json')
      }
      return
    }

  } catch (error) {
    //hide loding indicator
    hideElement('widget-loading-spinner')
    
    showRedirectError('PIV Login Failed!<BR>'+error) 
    
    console.error(error)
    pivOutput.innerHTML =  `<B>Error</B> Calling API ${pivUrl}<BR\><PRE>${error}</PRE>`
  }
  
}

async function clickCallOktaApi(){
  toggleHide('api-buttons')
}
async function callApiOutputResult(url, useOktaSessionAuth){
  
  //clear output
  const apioutput = document.getElementById("output")
  apioutput.innerHTML = ''
  
  //config api auth type
  let headers = {}
  let credentials = 'same-origin' //default
  if(useOktaSessionAuth){
    credentials = 'include' //include cross origin cookies
  }else{
    const accessToken = await oktaAuthInstance.tokenManager.get('accessToken');
    headers = {
        'Authorization': 'Bearer '+accessToken.accessToken, 
    }
  }
  
  //show loding indicator
  showElement('loading-container')
  let options = {
      credentials,
      headers,
    }
  console.log('fetch options:',options)
  try {
    const response = await fetch(url,options)
    //check for error
    if (!response.ok) {
      console.error(response)
      
      //hide loding indicator
      hideElement('loading-container')
      
      //output error message
      apioutput.innerHTML =  `<B>Error</B> Calling API ${url}<BR\><PRE>${response.status} ${response.statusText}</PRE>`
      return
    }

    //everything is good, show the response!
    
    //hide loding indicator
    hideElement('loading-container')
    
    const json = await response.json()
    console.log('response.json()',json)
    
    apioutput.innerHTML =  `Called API ${url}`+'<BR\><PRE>'+JSON.stringify(json,null,4)+'</PRE>'
      
  } catch (error) {
    //hide loding indicator
    hideElement('loading-container')
    
    console.error(error)
    apioutput.innerHTML =  `<B>Error</B> Calling API ${url}<BR\><PRE>${error}</PRE>`
  }
}


async function clickMyAccountAuthenticators(){ 
  //callApiOutputResult(issuerHost + '/idp/myaccount/authenticators?expand=enrollments')
  //results in Error Calling API 406 Not Acceptable 
  
  showElement('loading-container')
  
  const urlmyaccountauthenticators = issuerHost + '/idp/myaccount/authenticators?expand=enrollments' // ?expand=enrollments
    
  const apioutput = document.getElementById("output")
  
  const accessToken = await oktaAuthInstance.tokenManager.get('accessToken');
    
  try {
    const response = await fetch(urlmyaccountauthenticators,
    {
      headers:{
        accept:'application/json; okta-version=1.0.0',
        Authorization: 'Bearer '+accessToken.accessToken, 
      },
    })
    
    //hide loding indicator
    hideElement('loading-container')
    
    //is there an error?
    if (!response.ok) {
      console.error(response)
      
      
      //output error message
      apioutput.innerHTML = `<B>Error</B> Calling ${urlmyaccountauthenticators}<BR\><PRE>${response.status} ${response.statusText}</PRE>`
      try{
        const json = await response.json()
        apioutput.innerHTML = apioutput.innerHTML + JSON.stringify(json,null,4)
        
        showRedirectError('PIV Login Failed!<BR>'+json?.errorSummary) 
      }catch(err){
        console.log('mtls response invalid json')
      }
      return
    }

    //everything is good!
    const json = await response.json()
    console.log('response.json()',json)

    apioutput.innerHTML =  `Called API ${urlmyaccountauthenticators}`+'<BR\><PRE>'+JSON.stringify(json,null,4)+'</PRE>'
    return
    
  } catch (error) {
    //hide loding indicator
    hideElement('loading-container')
    
    console.error(error)
    apioutput.innerHTML =  `<B>Error</B> Calling API ${urlmyaccountauthenticators}<BR\><PRE>${error}</PRE>`
  }
  
}

function clickApiSessionsMe(){
  callApiOutputResult(issuerHost + '/api/v1/sessions/me', true)
}
function clickApiReadUserFactors(){
  callApiOutputResult(issuerHost + '/api/v1/users/me/factors')
}
function clickApiReadUser(){
  callApiOutputResult(issuerHost + '/api/v1/users/me')
}
function clickApiReadUserGroups(){
  callApiOutputResult(issuerHost + '/api/v1/users/me/groups')
}
function clickApiAppLinks(){
  callApiOutputResult(issuerHost + '/api/v1/users/me/appLinks')
}
function clickApiUserinfo(){
  callApiOutputResult(issuerHost + '/oauth2/v1/userinfo')
}
function clickSignOut() {
  //refreshes page via redirect
  signIn.authClient.signOut({
      clearTokensBeforeRedirect: true,
      postLogoutRedirectUri: location.protocol.concat("//").concat(window.location.host)
  })
  hideElement('logged-out-container')
  hideElement('logged-in-container')
  hideElement('tokens')

  showElement('loading-container')
}
async function clickShowTokens() {

  hideElement('show-tokens')
  showElement('hide-tokens')

  const tokens = await oktaAuthInstance.tokenManager.getTokens()
    
  document.getElementById("tokens").innerHTML = formatTokenOutput(tokens)
}
function clickHideTokens() {

  showElement('show-tokens')
  hideElement('hide-tokens')

  document.getElementById("tokens").innerHTML = ''
}

// &nbsp; <button onclick="clickIntrospectToken('${tokenObj[token][token]}','${token}')">🔎 Introspect</button>

// async function clickIntrospectToken(token, type){
//     //clear output
//   document.getElementById("output").innerHTML = ''
  
//   //show loding indicator
//   showElement('loading-container')
  
//   const url = issuerHost + '/oauth2/v1/introspect'
//   const formData = new FormData()
//   formData.append('client_id', signIn.options.clientId)
//   formData.append('token', token)
//   switch(type){
//     case 'accessToken':
//       type='access_token'
//       break;
//     case 'idToken':
//       type='id_token'
//       break;
//   }
//   formData.append('token_type_hint', type)
  
//   try {
//     const response = await fetch(url,
//     {
//        mode:'no-cors',
//       method: 'POST',
//       body:formData
//     })
//     if (!response.ok) {
//       console.error(response)
      
//       //hide loding indicator
//       hideElement('loading-container')
      
//       //output error message
//       document.getElementById("output").innerHTML =  `<B>Error</B> Calling API ${url}<BR\><PRE>${response.status} ${response.statusText}</PRE>`
//       return
//     }

//     //hide loding indicator
//     hideElement('loading-container')
    
//     const json = await response.json()
//     console.log('response.json()',json)
    
//     document.getElementById("output").innerHTML =  `Called API ${url}`+'<BR\><PRE>'+JSON.stringify(json,null,4)+'</PRE>'
      
//   } catch (error) {
//     //hide loding indicator
//     hideElement('loading-container')
    
//     console.error(error)
//     document.getElementById("output").innerHTML =  `<B>Error</B> Calling API ${url}<BR\><PRE>${error}</PRE>`
//   }
// }
function formatTokenOutput(tokenObj) {
  let output = ''
  for (const token in tokenObj) {
      if (token === 'refreshToken') {
          output += `<PRE><B>${token}</B><BR />${JSON.stringify(convertClaimsUtcToLocaleDates(tokenObj[token]), null, 4)}</PRE>`
      } else {
          output += `<PRE><B>${token}</B><BR />${JSON.stringify(convertClaimsUtcToLocaleDates(tokenObj[token].claims), null, 4)}</PRE>`
      }
  }
  return output
}

function convertClaimsUtcToLocaleDates(token) {
  const timeClaims = ['iat', 'exp', 'expiresAt', 'auth_time']

  const formattedToken = {}

  for (const claim in token) {
      if (timeClaims.includes(claim)) {
          formattedToken[claim] = token[claim] + ' (' + convertTimeStampToDateTimeString(token[claim]) + ')'
      } else {
          formattedToken[claim] = token[claim]
      }
  }
  return formattedToken
}

function convertTimeStampToDateTimeString(timestamp) {
  const dateToFormat = new Date(parseInt(timestamp, 10) * 1000)
  return dateToFormat.toLocaleDateString() + ' ' + dateToFormat.toLocaleTimeString()
}

function setInnerText(elementId, text) {
  document.getElementById(elementId).innerText = text
}

function hideElement(id) {
  const el = document.getElementById(id)
  if(el){
    el.classList.add('hide-element')
  }
}

function toggleHide(id) {
  const el = document.getElementById(id)
  if(el){
    el.classList.toggle('hide-element')
  }
}
function showElement(id) {
  const el = document.getElementById(id)
  if(el){
    el.classList.remove('hide-element')
  }
}

//TOTP.js from:
// https://github.com/turistu/totp-in-javascript

async function totp(key, secs = 30, digits = 6){
  return hotp(unbase32(key), pack64bu(Date.now() / 1000 / secs), digits);
}
async function hotp(key, counter, digits){
  let y = self.crypto.subtle;
  if(!y) throw Error('no self.crypto.subtle object available');
  let k = await y.importKey('raw', key, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
  return hotp_truncate(await y.sign('HMAC', k, counter), digits);
}
function hotp_truncate(buf, digits){
  let a = new Uint8Array(buf), i = a[19] & 0xf;
  return fmt(10, digits, ((a[i]&0x7f)<<24 | a[i+1]<<16 | a[i+2]<<8 | a[i+3]) % 10**digits);
}

function fmt(base, width, num){
  return num.toString(base).padStart(width, '0')
}
function unbase32(s){
  let t = (s.toLowerCase().match(/\S/g)||[]).map(c => {
    let i = 'abcdefghijklmnopqrstuvwxyz234567'.indexOf(c);
    if(i < 0) throw Error(`bad char '${c}' in key`);
    return fmt(2, 5, i);
  }).join('');
  if(t.length < 8) throw Error('key too short');
  return new Uint8Array(t.match(/.{8}/g).map(d => parseInt(d, 2)));
}
function pack64bu(v){
  let b = new ArrayBuffer(8), d = new DataView(b);
  d.setUint32(0, v / 2**32);
  d.setUint32(4, v);
  return b;
}
