@echo off
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%
cd /d C:\Users\HADID\Documents\Delivery_app\courier-native\android
echo Building APK...
call gradlew.bat assembleRelease
if %ERRORLEVEL% == 0 (
    echo.
    echo BUILD EXITOSO
    echo APK listo en:
    echo courier-native\android\app\build\outputs\apk\release\app-release.apk
) else (
    echo.
    echo BUILD FALLIDO - Revisa el error arriba
)
pause
