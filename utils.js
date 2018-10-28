
class Utils {
    dictToFormattedString(dict, key_value_sep = '=', separator = '&') {
        var str = [];
        for(var p in dict){
            str.push(p + key_value_sep + dict[p]);
        }
        
        return str.join(separator);
    }
    
    dictToSearchOption(dict) {
        return this.dictToFormattedString(dict, ':', '+')
    }
}
module.exports = Utils;