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
4. Nothing to edit: `app.config.js` switches Firebase on by itself when `google-services.json` is in the `mobile` folder. (Do not add it to .gitignore / .easignore, or the cloud build will not see it.)
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

## Notifications when the app is in the background (no Firebase)
The app checks for new notifications in the background roughly every 15 minutes (Android decides the exact time) and shows them in the notification bar. This works only in the installed APK, not in Expo Go.

After installing the APK, do these once so Android does not stop the app:
1. Open the app, sign in and **allow notifications** when asked.
2. When asked about background activity, tap **Continue > Allow**. (Or bell > Turn on phone alerts.)
3. Phone Settings > Apps > School Portal > Battery > choose **Unrestricted** (wording varies by phone).
4. Xiaomi / Redmi / Oppo / Realme / Vivo / OnePlus / Samsung: also turn on **Autostart** and lock the app in the recent-apps screen, otherwise the phone kills it. See dontkillmyapp.com for your brand.
Instant alerts for a fully closed app need Firebase push (guide above).
