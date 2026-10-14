# Build the Android APK (needed for real push notifications)

Expo Go cannot receive push notifications on Android. A real APK can. You build it in Expo's cloud (free tier is fine), so you do not need Android Studio.

## One-time setup (about 20 minutes)

### 1. Install the tools and sign in
```
npm install -g eas-cli
eas login            # make a free account at expo.dev if you don't have one
```

### 2. Install the packages (from the `mobile` folder)
```
cd mobile
npm install
npx expo install expo-notifications expo-device
```
(`run-mobile` already installs the rest. This makes sure `package.json` lists everything the cloud build needs.)

### 3. Link the project to your Expo account
```
eas init
```
It adds your `projectId` to `app.json`. Push tokens need this.

### 4. Firebase (Google's push service - Android requires it)
1. Go to https://console.firebase.google.com and create a project (any name; you can switch Analytics off).
2. Add an **Android app**. The package name must be exactly `com.schoolportal.mobile` (or whatever you set in `app.json` under `android.package` - they must match).
3. Download **google-services.json** and put it inside the `mobile` folder.
4. In `app.json`, inside `"android"`, add the line `"googleServicesFile": "./google-services.json"` so it reads:
   `"android": { "package": "com.schoolportal.mobile", "googleServicesFile": "./google-services.json" }`
5. In Firebase: Project settings > **Service accounts** > **Generate new private key**. Keep that JSON file.
6. Give that key to Expo: run `eas credentials`, choose **Android > production (or preview) > Google Service Account > Manage your Google Service Account Key for Push Notifications (FCM V1)** and upload the JSON.

### 5. Build the APK
```
eas build -p android --profile preview
```
Wait for it to finish (10-20 minutes). It gives a link and a QR code. Open the link on your phone, download the **.apk**, and install it (allow "install unknown apps" when asked).

## Using it
1. Open the app and sign in.
2. Tap the bell > **Turn on phone alerts** and allow notifications. It should say alerts are on.
3. From the web portal: Communication > Send notification > send one to yourself. It should buzz your phone.

## Good to know
- The server address is set in `eas.json` (`EXPO_PUBLIC_API_URL`). Change it there if your server moves, then rebuild.
- After the first build, changes to the app's JavaScript still need a new build (or set up `eas update`). Server changes never need a rebuild.
- If "Turn on phone alerts" says something failed, the message names the reason (usually the Firebase step 4/6 above).
- For the Play Store later use `--profile production` (makes an .aab instead of an .apk).
