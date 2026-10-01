package de.stegmann.breadcrum;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

public final class MainActivity extends Activity {
    static final String EXTRA_SHOW_TOKEN = "show_token_dialog";
    private static final String BOOKMARKS_URL = "https://breadcrum.net/bookmarks";
    private WebView webView;
    private ProgressBar progressBar;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        createWebView();
        configureBackNavigation();
        String initialUrl = getTargetUrl(getIntent());
        if (state != null) webView.restoreState(state); else webView.loadUrl(initialUrl);
        if (TokenStore.get(this) == null || getIntent().getBooleanExtra(EXTRA_SHOW_TOKEN, false)) {
            webView.post(this::showTokenDialog);
        }
    }

    private String getTargetUrl(Intent intent) {
        if (intent != null && intent.getData() != null && isBreadcrum(intent.getData())) {
            return intent.getData().toString();
        }
        return BOOKMARKS_URL;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isBreadcrum(request.getUrl())) return false;
                openExternally(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }
        });
        webView.setDownloadListener((url, ua, disposition, mime, length) -> openExternally(Uri.parse(url)));
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        root.addView(progressBar, new FrameLayout.LayoutParams(-1, dp(3)));

        // Handle system insets (status bar, navigation bar, display cutout)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int topInset = insets.getInsets(WindowInsets.Type.statusBars()).top;
                int bottomInset = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                int leftInset = insets.getInsets(WindowInsets.Type.displayCutout()).left;
                int rightInset = insets.getInsets(WindowInsets.Type.displayCutout()).right;
                // Apply padding to keep content below status bar and above navigation bar
                view.setPadding(leftInset, topInset, rightInset, bottomInset);
                return WindowInsets.CONSUMED;
            });
        }

        setContentView(root);
    }

    private void configureBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getData() != null && isBreadcrum(intent.getData())) {
            webView.loadUrl(intent.getData().toString());
        }
        if (intent.getBooleanExtra(EXTRA_SHOW_TOKEN, false)) showTokenDialog();
    }

    private void showTokenDialog() {
        if (isFinishing()) return;

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(8), dp(24), 0);

        TextView help = new TextView(this);
        help.setText(R.string.token_help);
        EditText input = new EditText(this);
        input.setHint(R.string.token_hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(help);
        content.addView(input);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(R.string.token_title)
                .setView(content)
                .setPositiveButton(R.string.token_save, null)
                .setNegativeButton(R.string.later, null)
                .create();

        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> {
                    String token = input.getText().toString().trim();
                    if (token.isEmpty()) {
                        input.setError(getString(R.string.token_hint));
                        return;
                    }
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                    help.setText(R.string.token_checking);
                    ApiClient.validateToken(token, result -> runOnUiThread(() -> {
                        if (isFinishing()) return;
                        if (result == ApiClient.Result.SAVED) {
                            try {
                                TokenStore.save(this, token);
                                Toast.makeText(this, R.string.token_saved, Toast.LENGTH_SHORT).show();
                                dialog.dismiss();
                            } catch (Exception ignoredSaveError) {
                                help.setText(R.string.token_invalid);
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                            }
                        } else {
                            help.setText(R.string.token_invalid);
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        }
                    }));
                }));
        dialog.show();
    }

    private static boolean isBreadcrum(Uri uri) {
        String host = uri.getHost();
        return "https".equalsIgnoreCase(uri.getScheme()) && host != null
                && (host.equalsIgnoreCase("breadcrum.net") || host.toLowerCase(Locale.ROOT).endsWith(".breadcrum.net"));
    }

    private void openExternally(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException ignored) { Toast.makeText(this, uri.toString(), Toast.LENGTH_LONG).show(); }
    }

    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() { if (webView.canGoBack()) webView.goBack(); else finish(); }
    @Override protected void onSaveInstanceState(Bundle state) { webView.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onDestroy() { webView.destroy(); super.onDestroy(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
