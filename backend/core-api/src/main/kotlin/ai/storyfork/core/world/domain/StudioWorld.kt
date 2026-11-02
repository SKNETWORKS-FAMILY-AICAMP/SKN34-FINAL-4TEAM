package ai.storyfork.core.world.domain

// User labels are independent of extraction categories and topics.
data class StudioSetting(val item:InitialItem,val userCategory:String="설정",val tags:List<String> = emptyList())
data class StudioAnalysis(val id:String,val status:String,val input:InitialInput,val candidates:List<InitialItem> = emptyList(),
 val issues:List<String> = emptyList(),val rawOutput:String?=null,val coverage:List<InitialCoverage> = emptyList())
data class StudioWorld(val id:String,val name:String,val description:String,val version:Int=1,
 val settings:List<StudioSetting> = emptyList(),val analysis:StudioAnalysis?=null)
