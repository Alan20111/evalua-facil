# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Números de línea en los fallos que reporta Play Console (Android vitals),
# sin el nombre real del archivo. Play los traduce con el mapping.txt que
# se sube junto con el AAB.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# @capacitor-firebase/authentication trae manejadores para todos los
# proveedores, pero solo usamos Google (capacitor.config.json → providers).
# El SDK de Facebook no está instalado: sus clases faltan a propósito.
-dontwarn com.facebook.**
