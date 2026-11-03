package ai.storyfork.core.world.controller

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

class WorldStudioAccessFilterTest {
 private val filter=WorldStudioAccessFilter("http://127.0.0.1:5177")
 private fun request(origin:String?="http://127.0.0.1:5177",remote:String="127.0.0.1",uri:String="/api/v1/studio/session")=MockHttpServletRequest("POST",uri).also {
  it.remoteAddr=remote;if(origin!=null)it.addHeader("Origin",origin)
 }
 @Test fun configuredLocalQaOriginIsAccepted() {
  val req=request();val res=MockHttpServletResponse();val chain=MockFilterChain()
  filter.doFilter(req,res,chain);assertSame(req,chain.request)
 }
 @Test fun unconfiguredOriginIsRejected() {
  val res=MockHttpServletResponse();val chain=MockFilterChain()
  filter.doFilter(request("https://untrusted.example"),res,chain)
  assertEquals(403,res.status);assertNull(chain.request)
 }
 @Test fun remoteRequestsCannotUseTheLocalSession() {
  val res=MockHttpServletResponse();val chain=MockFilterChain()
  filter.doFilter(request(remote="203.0.113.10"),res,chain)
  assertEquals(403,res.status);assertNull(chain.request)
 }
 @Test fun privateWorldRequestsStillRequireASession() {
  val res=MockHttpServletResponse();val chain=MockFilterChain()
  filter.doFilter(request(uri="/api/v1/studio/worlds"),res,chain)
  assertEquals(401,res.status);assertNull(chain.request)
 }
}
