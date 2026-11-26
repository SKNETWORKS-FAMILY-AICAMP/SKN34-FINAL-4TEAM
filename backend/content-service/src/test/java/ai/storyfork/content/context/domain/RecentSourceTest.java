package ai.storyfork.content.context.domain;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RecentSourceTest {
    @Test void preservesParagraphAndCut() {
        String s = "prior\r\n새😀 단락\n끝 FUTURE";
        int cut = s.indexOf(" FUTURE");
        var r = RecentSource.select("original", 2, "v2", s, cut, 6);
        assertEquals("새😀 단락\n끝", r.text());
        assertEquals(java.util.List.of(7,cut), r.span());
        assertEquals("끝", RecentSource.select("original",2,"v2",s,cut,1).text());
    }
    @Test void rejectsInvalidCuts() {
        for (int cut : new int[]{-1,1,3}) {
            assertThrows(IllegalArgumentException.class, () -> RecentSource.select("original",1,"v","😀",cut,10));
        }
    }
}
