package ai.storyfork.core.world.controller

import org.springframework.beans.factory.annotation.Value
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.net.InetAddress

@Component
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class WorldStudioAccessFilter(@param:Value("\${app.cors.allowed-origin}") private val configuredOrigin:String):OncePerRequestFilter() {
 override fun doFilterInternal(req:HttpServletRequest,res:HttpServletResponse,chain:FilterChain) {
  if(!req.requestURI.startsWith("/api/v1/studio")) {chain.doFilter(req,res);return}
  fun deny(code:Int) {res.status=code;res.contentType="application/json";res.writer.write("{\"detail\":\"Local studio access denied\"}")}
  if(!InetAddress.getByName(req.remoteAddr).isLoopbackAddress) {deny(403);return}
  val origins=setOf("http://localhost:5173","http://127.0.0.1:5173","http://localhost:5175","http://127.0.0.1:5175",configuredOrigin)
  if(req.method !in setOf("GET","HEAD","OPTIONS") && req.getHeader("Origin") !in origins) {deny(403);return}
  if(req.requestURI!="/api/v1/studio/session" && req.getSession(false)?.getAttribute("studioActor") !in setOf("author","reader1","reader2")) {deny(401);return}
  chain.doFilter(req,res)
 }
}
