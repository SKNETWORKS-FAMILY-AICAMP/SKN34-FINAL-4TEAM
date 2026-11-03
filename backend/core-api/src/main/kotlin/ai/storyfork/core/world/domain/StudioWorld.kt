package ai.storyfork.core.world.domain

data class AuthorSetting(val id:String,val title:String,val text:String,val kind:String="fact",val origin:String="author_addition",val authorText:String=text,val decision:String="approved",val category:String="basic",val entityType:String?=null,val topics:List<String> = emptyList())
data class StudioSetting(val item:AuthorSetting,val userCategory:String="설정",val tags:List<String> = emptyList())
data class StudioWorld(val id:String,val name:String,val description:String,val version:Int=1,val settings:List<StudioSetting> = emptyList())
