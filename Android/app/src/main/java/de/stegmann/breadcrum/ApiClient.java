package de.stegmann.breadcrum;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ApiClient {
    enum Result { CREATED, NO_CHANGE, SAVED, UNAUTHORIZED, ERROR }

    interface Callback { void complete(Result result); }

    private static final String API = "https://breadcrum.net/api/bookmarks";
    private static final Pattern WEB_URL = Pattern.compile("https?://[^\\s<>]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUDIO_PATH = Pattern.compile(
            "\\.(aac|aif|aiff|amr|au|caf|flac|m4a|m4b|mka|mp2|mp3|oga|ogg|opus|wav|wave|weba|wma)$",
            Pattern.CASE_INSENSITIVE
    );
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    private ApiClient() {}

    static void validateToken(String token, Callback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = open(API + "?per_page=1", "GET", token);
                int status = connection.getResponseCode();
                callback.complete(status >= 200 && status < 300 ? Result.SAVED
                        : status == 401 ? Result.UNAUTHORIZED : Result.ERROR);
            } catch (Exception ignored) {
                callback.complete(Result.ERROR);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    static void saveBookmark(String token, String url, String title, Callback callback) {
        EXECUTOR.execute(() -> callback.complete(save(token, url, title)));
    }

    private static Result save(String token, String url, String title) {
        boolean youtube = isYouTubeUrl(url);
        boolean createEpisode = youtube || isAudioFileUrl(url);
        String endpoint = API + "?meta=true&episode=" + createEpisode
                + "&archive=false&normalize=true";
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject().put("url", url);
            if (title != null && !title.trim().isEmpty()) body.put("title", title.trim());
            if (youtube) body.put("tags", new JSONArray().put("video"));

            connection = open(endpoint, "PUT", token);
            connection.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }

            int status = connection.getResponseCode();
            if (status == 401) return Result.UNAUTHORIZED;
            if (status < 200 || status >= 300) return Result.ERROR;

            String response = read(connection.getInputStream());
            if (!response.isEmpty()) {
                String resultStatus = new JSONObject(response).optString("status", "");
                if ("created".equals(resultStatus)) return Result.CREATED;
                if ("nochange".equals(resultStatus)) return Result.NO_CHANGE;
            }
            return status == 201 ? Result.CREATED : Result.SAVED;
        } catch (Exception ignored) {
            return Result.ERROR;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static HttpURLConnection open(String endpoint, String method, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        connection.setInstanceFollowRedirects(false);
        return connection;
    }

    private static String read(InputStream input) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buffer = new char[2048];
            int count;
            while ((count = reader.read(buffer)) >= 0 && result.length() < 32_768) {
                result.append(buffer, 0, count);
            }
        }
        return result.toString();
    }

    static String extractUrl(String text) {
        if (text == null) return null;
        Matcher matcher = WEB_URL.matcher(text);
        if (!matcher.find()) return null;
        String url = matcher.group();
        while (!url.isEmpty() && ".,;:!?)\"]}".indexOf(url.charAt(url.length() - 1)) >= 0) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    static boolean isYouTubeUrl(String value) {
        String host = Uri.parse(value).getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("youtu.be") || host.equals("youtube.com") || host.endsWith(".youtube.com")
                || host.equals("youtube-nocookie.com") || host.endsWith(".youtube-nocookie.com");
    }

    static boolean isAudioFileUrl(String value) {
        String path = Uri.parse(value).getPath();
        return path != null && AUDIO_PATH.matcher(path).find();
    }
}
