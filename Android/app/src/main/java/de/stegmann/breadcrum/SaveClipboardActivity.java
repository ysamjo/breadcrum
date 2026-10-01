package de.stegmann.breadcrum;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

public final class SaveClipboardActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || !clipboard.hasPrimaryClip()) {
            toast(R.string.no_url_in_clipboard);
            finish();
            return;
        }

        ClipData clip = clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) {
            toast(R.string.no_url_in_clipboard);
            finish();
            return;
        }

        CharSequence text = clip.getItemAt(0).getText();
        String rawText = text != null ? text.toString() : null;
        String url = ApiClient.extractUrl(rawText);
        if (url == null) {
            toast(R.string.no_url_in_clipboard);
            finish();
            return;
        }

        String token = TokenStore.get(this);
        if (token == null || token.trim().isEmpty()) {
            toast(R.string.token_required);
            Intent setup = new Intent(this, MainActivity.class)
                    .putExtra(MainActivity.EXTRA_SHOW_TOKEN, true)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(setup);
            finish();
            return;
        }

        toast(R.string.saving);
        ApiClient.saveBookmark(token, url, null, result ->
                runOnUiThread(() -> finishWith(result))
        );
    }

    private void finishWith(ApiClient.Result result) {
        if (result == ApiClient.Result.CREATED || result == ApiClient.Result.SAVED) {
            toast(R.string.saved);
        } else if (result == ApiClient.Result.NO_CHANGE) {
            toast(R.string.already_saved);
        } else if (result == ApiClient.Result.UNAUTHORIZED) {
            TokenStore.clear(this);
            toast(R.string.token_expired);
        } else {
            toast(R.string.save_failed);
        }
        finish();
    }

    private void toast(int message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
