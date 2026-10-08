# Breadcrum Android

Minimale WebView-App. Normaler Start zeigt die Breadcrum-Bookmarks. Geteilte
Links werden direkt über die Breadcrum-API gespeichert, ohne die sichtbare App
zu verlassen. YouTube-Links und erkennbare Audio-Datei-URLs wie MP3, M4A, OGG,
OPUS, WAV oder FLAC verwenden `episode=true`; andere Links `episode=false`.

Der API-Token wird einmalig in der App eingegeben, geprüft und verschlüsselt über
den Android-Keystore auf dem Gerät gespeichert. Er steht nicht im Quellcode.
