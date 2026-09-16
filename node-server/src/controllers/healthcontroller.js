const checkHealth = async(req,res)=>{
    return res.code(200).send({status:"ok",timestamp: new Date().toISOString()});
}

module.exports = {checkHealth};