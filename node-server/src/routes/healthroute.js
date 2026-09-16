const {checkHealth} = require("../controllers/healthcontroller");

async function healthRoute(fastify,options){
    fastify.get("/health",checkHealth);

    fastify.get("/",async(req,res)=>{
        return res.code(200).send({message:"Suppp my nigga!!, serving the api"});
    });
}

module.exports = healthRoute;