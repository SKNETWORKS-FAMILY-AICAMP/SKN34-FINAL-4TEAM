package ai.storyfork.content.context.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/** Offsets are half-open UTF-16 indices in this published version, before JSON escaping. */
public record RecentSource(String branch, int episode, String versionId, String edition,
                           List<Integer> span, String text, String sha256) {
    public static RecentSource select(String branch, int episode, String versionId,
                                      String body, int cut, int window) {
        if (window < 1 || cut < 0 || cut > body.length() || splitsPair(body, cut)
                || versionId.isBlank() || episode < 1) {
            throw new IllegalArgumentException("Invalid recent source version or UTF-16 range");
        }
        int start = Math.max(0, cut - window);
        if (splitsPair(body, start)) start--;
        // Treat CRLF as one separator: never begin between CR and LF.
        if (start > 0 && start < cut && body.charAt(start - 1) == '\r' && body.charAt(start) == '\n') start--;
        while (start > 0 && "\r\n\u2029".indexOf(body.charAt(start - 1)) < 0) start--;
        String text = body.substring(start, cut);
        return new RecentSource(branch, episode, versionId, hash(body), List.of(start, cut), text, hash(text));
    }

    private static boolean splitsPair(String body, int at) {
        return at > 0 && at < body.length() && Character.isSurrogatePair(body.charAt(at - 1), body.charAt(at));
    }

    private static String hash(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
